import { Router, Route } from "@solidjs/router";
import type { Component } from "solid-js";
import { DiffPage } from "./pages/DiffPage";
import { EndpointsPage } from "./pages/EndpointsPage";
import { EnvironmentsPage } from "./pages/EnvironmentsPage";
import { FilesPage } from "./pages/FilesPage";
import { HistoryPage } from "./pages/HistoryPage";
import { JourneyEditorPage } from "./pages/JourneyEditorPage";
import { JourneysPage } from "./pages/JourneysPage";
import { ProjectPage } from "./pages/ProjectPage";
import { Shell } from "./shell/Shell";

export const App: Component = () => (
  <Router root={Shell}>
    <Route path="/" component={ProjectPage} />
    <Route path="/files" component={FilesPage} />
    <Route path="/endpoints" component={EndpointsPage} />
    <Route path="/journeys" component={JourneysPage} />
    <Route path="/environments" component={EnvironmentsPage} />
    <Route path="/editor" component={JourneyEditorPage} />
    <Route path="/diff" component={DiffPage} />
    <Route path="/history" component={HistoryPage} />
  </Router>
);
