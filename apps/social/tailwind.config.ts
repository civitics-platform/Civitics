import type { Config } from "tailwindcss";
import { baseConfig } from "@civitics/config/tailwind/base";

const config: Config = {
  ...baseConfig,
  content: [
    "./src/**/*.{ts,tsx}",
    "../../packages/ui/src/**/*.{ts,tsx}",
  ],
  theme: {
    ...baseConfig.theme,
  },
};

export default config;
