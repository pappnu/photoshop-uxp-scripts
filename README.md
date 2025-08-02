# Photoshop UXP Automation Scripts

Scripts for automating miscellaneous actions in Photoshop.

## Requirements

Photoshop 26.9 or newer.

For development:

[Node.js](https://nodejs.org)

## Usage

Open the script you want to run via `File -> Open...` in Photoshop.

## Scripts

### autoAlignSmartObjects

Applies the auto-align action to selected smart objects. This is done by copying, maximizing and rasterizing the selected smart objects after which the resultant dimensions are applied to the original smart objects. At the time of writing, Photoshop doesn't support directly applying the auto-align action to smart objects, which is why this script exists.

## Development environment

Install dependencies

```
npm install
```

Transpile scripts

```
npm run build
```

The transpiled scripts are outputted to `./dist`.

## License

MIT
