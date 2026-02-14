import { render } from "solid-js/web";
import { App } from "./app";
import "./stores/theme";
import "./styles/base.css";

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");

render(() => <App />, root);
