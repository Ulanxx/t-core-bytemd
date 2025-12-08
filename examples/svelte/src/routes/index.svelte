<script>
  import { Editor } from '@t-agent/bytemd'
  import gfm from '@t-agent/bytemd-plugin-gfm'
  import '@t-agent/bytemd/dist/index.css'

  let value = ''
  let plugins = [gfm()]
</script>

<div class="container">
  <Editor
    {value}
    on:change={(e) => {
      value = e.detail.value
    }}
    {plugins}
  />
</div>

<style>
  .container {
    max-width: 1200px;
    margin: 0 auto;
  }
</style>
