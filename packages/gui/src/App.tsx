import { Router, Route } from "@solidjs/router";
import type { Component } from "solid-js";
import { FilesPage } from "./pages/FilesPage";
import { ProjectPage } from "./pages/ProjectPage";

const Shell: Component<{ children?: unknown }> = (props) => (
  <div class="flex h-full">
    <nav class="w-56 border-r border-slate-800 bg-slate-900/60 p-4 flex flex-col gap-2">
      <div class="text-lg font-semibold text-brand-500">Journey</div>
      <div class="text-xs uppercase tracking-wider text-slate-500 mt-4">Project</div>
      <a href="/" class="px-2 py-1 rounded hover:bg-slate-800">
        Overview
      </a>
      <a href="/files" class="px-2 py-1 rounded hover:bg-slate-800">
        Files
      </a>
    </nav>
    <main class="flex-1 p-6 overflow-auto">{props.children as any}</main>
  </div>
);

export const App: Component = () => (
  <Router root={Shell}>
    <Route path="/" component={ProjectPage} />
    <Route path="/files" component={FilesPage} />
  </Router>
);
