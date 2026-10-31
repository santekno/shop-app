// What `import "../global.css"` (app/_layout.tsx) loads under Jest. In the
// app, NativeWind's Metro plugin compiles the file into React Native
// styles; Jest has no Metro, so the import is mapped here (jest.config.js).
module.exports = {};
