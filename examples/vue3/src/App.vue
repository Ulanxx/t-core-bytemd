<script setup lang="ts">
import { ref } from 'vue'
import { Editor } from '@t-agent/bytemd-vue-next'
import gfm from '@t-agent/bytemd-plugin-gfm'
import '@t-agent/bytemd/dist/index.css'

let content = ref('')

const plugins = [gfm()]

const handleChange = (v: string) => {
  content.value = v
}
</script>

<template>
  <main>
    <Editor :value="content" :plugins="plugins" @change="handleChange" />
  </main>
</template>

<style>
#app {
  max-width: 1280px;
  margin: 0 auto;
  padding: 2rem;
  font-weight: normal;
}
</style>
