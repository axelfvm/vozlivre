import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  envDir: "../..",
  plugins: [react()],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "livekit",
              test: /node_modules[\\/](?:@livekit|livekit-client)/,
              maxSize: 420_000,
              priority: 30,
            },
            {
              name: "react",
              test: /node_modules[\\/](?:react|react-dom|scheduler)[\\/]/,
              priority: 20,
            },
            {
              name: "realtime",
              test: /node_modules[\\/](?:socket\.io-client|engine\.io-client)[\\/]/,
              priority: 10,
            },
          ],
        },
      },
    },
  },
});
