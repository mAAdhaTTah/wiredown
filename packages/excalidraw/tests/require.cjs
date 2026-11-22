// Renders the screen tree in argv[2] through the built Node entry from CommonJS.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- the point of this file
const { renderScreenSvg } = require("@wiredown/excalidraw/node");

renderScreenSvg(JSON.parse(process.argv[2])).then(({ svg }) => process.stdout.write(svg));
