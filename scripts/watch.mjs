// @ts-check
import { createVue3Plugin } from '../packages/vue-next/plugin.mjs'
import { createVuePlugin } from '../packages/vue/plugin.mjs'
import { packages, packagesDir, sveltePreprocessor } from './utils.mjs'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { execaCommand } from 'execa'
import glob from 'fast-glob'
import fs from 'fs-extra'
import { camelCase } from 'lodash-es'
import path from 'path'
import resolve from 'resolve'
import { emitDts } from 'svelte2tsx'
import { preprocess } from 'svelte/compiler'
import { build } from 'vite'
import chokidar from 'chokidar'

// Build a single package
async function buildPackage(name) {
  console.log(`[building] ${name}`)

  const root = path.resolve(packagesDir, name)
  const originalCwd = process.cwd()
  
  try {
    process.chdir(root)

    if (name === 'bytemd') {
      // some parts are from here https://github.com/sveltejs/kit/blob/master/packages/kit/src/packaging/typescript.js
      await emitDts({
        svelteShimsPath: 'node_modules/svelte2tsx/svelte-shims.d.ts',
        declarationDir: './dist',
      })
      glob.sync('./dist/src/*.svelte.d.ts').forEach((file) => {
        const dest = file.replace('/src', '')
        if (fs.existsSync(dest)) {
          fs.removeSync(dest)
        }
        fs.moveSync(file, dest)
      })
      fs.removeSync('./dist/src')
    }

    // build js
    const pkg = await fs.readJson(path.resolve(root, 'package.json'))

    for (let format of ['es', 'cjs', 'umd']) {
      const legacy = format === 'umd' || format === 'iife'
      const externalDeps = []

      if (legacy) {
        externalDeps.push(...Object.keys({ ...pkg.peerDependencies }))
      } else if (format === 'es') {
        externalDeps.push(
          ...Object.keys({
            ...pkg.peerDependencies,
            ...pkg.dependencies,
          })
        )
      } else if (format === 'cjs') {
        const deps = Object.keys({ ...pkg.dependencies })
          // exclude esm packages, bundle them to make it work for cjs
          .filter((dep) => {
            const pkgPath = path.resolve(
              root,
              'node_modules',
              dep,
              'package.json'
            )

            if (!fs.existsSync(pkgPath)) {
              throw new Error(`${dep} not exists, please install it`)
            }

            const { type: pkgType } = fs.readJsonSync(pkgPath)
            return pkgType !== 'module'
          })

        externalDeps.push(...Object.keys({ ...pkg.peerDependencies }), ...deps)
      }

      const alias = {
        // https://github.com/rollup/plugins/issues/1159
        // for plugin-highlight-ssr
        lowlight: 'lowlight/lib/common',
      }

      if (format === 'cjs') {
        const pkgName = 'decode-named-character-reference'

        // do not resolve `browser` field to make CJS bundle work at SSR
        // https://github.com/vitejs/vite/issues/4405
        // for bytemd and plugin-gfm
        alias[pkgName] = resolve.sync(pkgName)
      }

      await build({
        root,
        build: {
          emptyOutDir: false,
          minify: legacy,
          target: 'es2019', // nullish coalescing in es2020
          lib: {
            entry: 'src/index.ts',
            name: camelCase(pkg.name),
            formats: [format],
            fileName: 'index',
          },
          rollupOptions: {
            external: [
              ...externalDeps,
              ...externalDeps.map((dep) => new RegExp(`^${dep}\/`)),
            ],
          },
        },
        resolve: { alias },
        plugins: [
          name === 'bytemd' &&
            svelte({
              preprocess: [sveltePreprocessor],
            }),
          name === 'vue' && createVuePlugin(),
          name === 'vue-next' && createVue3Plugin(),
        ],
      })
    }

    if (name === 'bytemd') {
      await fs.emptyDir('svelte')

      console.log('build svelte files...')
      const files = await glob('src/*.svelte')
      for (let file of files) {
        const dest = file.replace('src/', 'svelte/')
        await fs.ensureDir(path.dirname(dest))

        if (fs.statSync(file).isDirectory()) return

        if (file.endsWith('.svelte')) {
          const source = await fs.readFile(file, 'utf8')
          const item = await preprocess(source, sveltePreprocessor, {
            filename: file,
          })
          await fs.writeFile(
            dest,
            item.code.replace('<script lang="ts">', '<script>')
          )
        }
      }

      console.log('build js files...')
      await execaCommand('tsc --project tsconfig.svelte.json')

      console.log('patch index js...')
      let js = await fs.readFile('svelte/index.js', 'utf8')
      js = js
        .split('\n')
        .filter((line) => !line.includes('index.scss'))
        .join('\n')
      await fs.writeFile('svelte/index.js', js)

      console.log('processing style files (backward compatibility)...')
      if (await fs.pathExists('dist/style.css')) {
        if (await fs.pathExists('dist/index.css')) {
          await fs.remove('dist/index.css')
        }
        await fs.move('dist/style.css', 'dist/index.css')
      }
      if (await fs.pathExists('dist/index.css')) {
        await fs.copy('dist/index.css', 'dist/index.min.css', { overwrite: true })
      }
    }

    // Run TypeScript build for type definitions
    await execaCommand('tsc --build', { cwd: root }).catch(() => {
      // Ignore TypeScript errors in watch mode
    })

    console.log(`[✓] ${name} built successfully`)
  } catch (error) {
    console.error(`[✗] Error building ${name}:`, error.message)
  } finally {
    process.chdir(originalCwd)
  }
}

// Get package name from file path
function getPackageName(filePath) {
  const relativePath = path.relative(packagesDir, filePath)
  const parts = relativePath.split(path.sep)
  return parts[0]
}

// Debounce function to avoid multiple builds
function debounce(func, wait) {
  let timeout
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout)
      func(...args)
    }
    clearTimeout(timeout)
    timeout = setTimeout(later, wait)
  }
}

// Track which packages are currently building
const building = new Set()

// Build queue
const buildQueue = new Set()

async function queueBuild(packageName) {
  if (building.has(packageName)) {
    buildQueue.add(packageName)
    return
  }

  building.add(packageName)
  await buildPackage(packageName)
  building.delete(packageName)

  // Process queue
  if (buildQueue.has(packageName)) {
    buildQueue.delete(packageName)
    queueBuild(packageName)
  }
}

// Debounced build function
const debouncedBuild = debounce((packageName) => {
  queueBuild(packageName)
}, 300)

// Watch for changes
console.log('Watching packages for changes...\n')

const watcher = chokidar.watch(
  packages.map((pkg) => path.join(packagesDir, pkg, 'src/**/*')),
  {
    ignored: /(^|[\/\\])\../, // ignore dotfiles
    persistent: true,
    ignoreInitial: true,
  }
)

watcher
  .on('change', (filePath) => {
    const packageName = getPackageName(filePath)
    if (packages.includes(packageName)) {
      console.log(`[changed] ${filePath}`)
      debouncedBuild(packageName)
    }
  })
  .on('add', (filePath) => {
    const packageName = getPackageName(filePath)
    if (packages.includes(packageName)) {
      console.log(`[added] ${filePath}`)
      debouncedBuild(packageName)
    }
  })
  .on('unlink', (filePath) => {
    const packageName = getPackageName(filePath)
    if (packages.includes(packageName)) {
      console.log(`[deleted] ${filePath}`)
      debouncedBuild(packageName)
    }
  })
  .on('error', (error) => {
    console.error('[watch error]', error)
  })

// Initial build of all packages
console.log('Building all packages initially...\n')
for (const pkg of packages) {
  await buildPackage(pkg)
}

console.log('\n✓ All packages built. Watching for changes...\n')

