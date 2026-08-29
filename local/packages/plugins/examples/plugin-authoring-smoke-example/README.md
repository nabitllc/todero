# Plugin Authoring Smoke Example

A Todero plugin

## Development

```bash
pnpm install
pnpm dev            # watch builds
pnpm dev:ui         # local dev server with hot-reload events
pnpm test
```

## Install Into Todero

```bash
npx todero plugin install ./
```

## Build Options

- `pnpm build` uses esbuild presets from `@todero/plugin-sdk/bundlers`.
- `pnpm build:rollup` uses rollup presets from the same SDK.
