const path = require('path');
const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = {
  mode: 'development',
  devtool: 'source-map', // avoid eval() which is blocked by CSP
  entry: './renderer/index.tsx',
  output: {
    path: path.resolve(__dirname, 'dist/renderer'),
    filename: 'bundle.js',
    clean: true,
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.js', '.jsx'],
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader'],
      },
    ],
  },
  plugins: [
    // Build-time flag: EXTRACTION_ONLY=1 produces the extraction-only variant
    // (hides the Booking List / auto-entry picker). Default '' = full app.
    new webpack.DefinePlugin({
      'process.env.EXTRACTION_ONLY': JSON.stringify(process.env.EXTRACTION_ONLY || ''),
    }),
    new HtmlWebpackPlugin({
      template: './renderer/index.html',
      filename: 'index.html',
    }),
  ],
  // Renderer runs in a browser context (contextIsolation: true, no Node in renderer)
  target: 'web',
  devServer: {
    port: 3000,
    hot: true,
    open: false,
    static: {
      directory: path.resolve(__dirname, 'dist/renderer'),
    },
  },
};
