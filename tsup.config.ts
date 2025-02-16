import { defineConfig } from 'tsup'

export default defineConfig({
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    external: ['zod'],
    clean: true,
    shims: true,
    sourcemap: true,
    dts: false,
})
