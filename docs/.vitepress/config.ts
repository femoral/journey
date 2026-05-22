import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Journey",
  description:
    "Local-first, offline tool for scaffolding and running API tests from an OpenAPI spec.",
  lang: "en-US",
  cleanUrls: true,
  lastUpdated: true,
  base: "/journey/",
  head: [["link", { rel: "icon", href: "/journey/favicon.ico" }]],
  themeConfig: {
    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "Reference", link: "/reference/journey-api/" },
      { text: "Sources", link: "/SOURCES" },
      {
        text: "GitHub",
        link: "https://github.com/femoral/journey",
      },
    ],
    sidebar: {
      "/guide/": [
        {
          text: "Guide",
          items: [{ text: "Getting started", link: "/guide/getting-started" }],
        },
        {
          text: "Writing journeys",
          link: "/guide/writing-journeys/",
          collapsed: false,
          items: [
            { text: "journey() and step()", link: "/guide/writing-journeys/journey-and-step" },
            { text: "Endpoints", link: "/guide/writing-journeys/endpoints" },
            { text: "Request inputs", link: "/guide/writing-journeys/request-inputs" },
            { text: "Timeouts", link: "/guide/writing-journeys/timeouts" },
            {
              text: "Assertions and hooks",
              link: "/guide/writing-journeys/assertions-and-hooks",
            },
            { text: "Lazy values", link: "/guide/writing-journeys/lazy-values" },
            { text: "State between steps", link: "/guide/writing-journeys/state" },
            { text: "expect() matchers", link: "/guide/writing-journeys/expect" },
            { text: "env() in journeys", link: "/guide/writing-journeys/env" },
            { text: "Sub-journeys", link: "/guide/writing-journeys/sub-journeys" },
            { text: "Patterns", link: "/guide/writing-journeys/patterns" },
          ],
        },
        {
          text: "Environments",
          link: "/guide/environments/",
          collapsed: false,
          items: [
            { text: "Selecting an environment", link: "/guide/environments/selection" },
            { text: "Secret handling", link: "/guide/environments/secrets" },
            { text: "Programmatic setup", link: "/guide/environments/programmatic" },
          ],
        },
        {
          text: "CLI",
          link: "/guide/cli/",
          collapsed: false,
          items: [
            { text: "journey init", link: "/guide/cli/init" },
            { text: "journey generate", link: "/guide/cli/generate" },
            { text: "journey run", link: "/guide/cli/run" },
            { text: "journey export k6", link: "/guide/cli/export-k6" },
            { text: "journey export postman", link: "/guide/cli/export-postman" },
            { text: "journey serve", link: "/guide/cli/serve" },
            { text: "journey env list", link: "/guide/cli/env-list" },
          ],
        },
        {
          text: "GUI",
          link: "/guide/gui/",
          collapsed: false,
          items: [
            { text: "Pages", link: "/guide/gui/pages" },
            { text: "Console dock", link: "/guide/gui/console-dock" },
            { text: "Palette and cURL import", link: "/guide/gui/palette-and-import" },
          ],
        },
      ],
      "/reference/": [
        {
          text: "Reference",
          items: [
            { text: "Step options", link: "/reference/step-options" },
            { text: "Config", link: "/reference/config" },
            { text: "OpenAPI codegen", link: "/reference/openapi-codegen" },
          ],
        },
        {
          text: "Journey API",
          link: "/reference/journey-api/",
          collapsed: false,
          items: [
            { text: "Runtime", link: "/reference/journey-api/runtime" },
            { text: "Sub-journeys", link: "/reference/journey-api/sub-journey" },
            { text: "HTTP", link: "/reference/journey-api/http" },
            { text: "Fetch", link: "/reference/journey-api/fetch" },
            { text: "Endpoints", link: "/reference/journey-api/endpoints" },
            { text: "Environment", link: "/reference/journey-api/environment" },
            { text: "Assertions", link: "/reference/journey-api/assertions" },
            { text: "Config API", link: "/reference/journey-api/config-api" },
            { text: "Logging", link: "/reference/journey-api/logging" },
            { text: "History", link: "/reference/journey-api/history" },
          ],
        },
      ],
    },
    outline: [2, 3],
    search: { provider: "local" },
    socialLinks: [{ icon: "github", link: "https://github.com/femoral/journey" }],
    editLink: {
      pattern: "https://github.com/femoral/journey/edit/main/docs/:path",
      text: "Edit this page on GitHub",
    },
    footer: {
      message: "Released under the MIT License.",
      copyright: "Copyright © Journey contributors",
    },
  },
});
