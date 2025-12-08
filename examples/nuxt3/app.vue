<script setup lang="ts">
import { Editor } from '@t-agent/bytemd-vue-next'
import gfm from '@t-agent/bytemd-plugin-gfm'

const content = ref('')
const plugins = [gfm()]
const handleChange = (v: string) => {
  content.value = v
}
</script>

<template>
  <ClientOnly>
    <Editor :value="content" :plugins="plugins" @change="handleChange" />
  </ClientOnly>
</template>
