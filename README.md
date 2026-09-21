# Littlegods Games

<<<<<<< HEAD
Littlegods Games es un launcher de escritorio para instalar y organizar el catalogo oficial de juegos de Littlegods.

=======
Launcher de escritorio construido con React, Electron y Node.js para organizar juegos propios o contenido que tengas autorización para descargar.

## Desarrollo

```bash
npm install
npm run dev
```

## Añadir juegos

La aplicación guarda el catálogo en la carpeta de datos de Electron. Usa **Añadir juego**, selecciona el archivo `.torrent` y elige la carpeta donde se guardará el juego.

La descarga usa WebTorrent directamente y no necesita qBittorrent.

## Paquetes

```bash
npm run dist:win
npm run dist:linux
```

`dist:win` genera un instalador `.exe` en `dist/`. `dist:linux` genera un `.AppImage` y debe ejecutarse en Linux o en CI Linux, porque AppImage requiere herramientas Linux como `mksquashfs`.

Usa únicamente torrents y juegos que puedas distribuir o descargar legalmente.# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

