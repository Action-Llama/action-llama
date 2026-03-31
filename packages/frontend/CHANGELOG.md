# @action-llama/frontend

## 0.18.0

### Minor Changes

- [#452](https://github.com/Action-Llama/action-llama/pull/452) [`f796147`](https://github.com/Action-Llama/action-llama/commit/f796147ccebe6bd1e242b0b6f5ba99575eab0e17) Thanks [@asselstine](https://github.com/asselstine)! - Add agent admin page with gear icon link from agent detail. Moves Scale, Enable/Disable, and Skill content to a combined admin page. Replaces Run/Chat buttons with a RunDropdown split-button component.

- [#449](https://github.com/Action-Llama/action-llama/pull/449) [`06a4c68`](https://github.com/Action-Llama/action-llama/commit/06a4c6862552f273297891dabd5c664d1fc11ca2) Thanks [@asselstine](https://github.com/asselstine)! - Replace running instances and jobs table on agent detail page with a filtered activity view showing 5 most recent items

- [#451](https://github.com/Action-Llama/action-llama/pull/451) [`771359b`](https://github.com/Action-Llama/action-llama/commit/771359b0da7a95c63d6c6dbfdcfef1c7f584a717) Thanks [@asselstine](https://github.com/asselstine)! - Move agent stats grid to a dedicated stats page with paginated runs table, and add a bar graph "Stats" link in the agent detail page header.

### Patch Changes

- [#450](https://github.com/Action-Llama/action-llama/pull/450) [`10b949a`](https://github.com/Action-Llama/action-llama/commit/10b949ac61c43872148ee611949903adab25f2c8) Thanks [@asselstine](https://github.com/asselstine)! - Hide the Token Usage by Agent graph on mobile viewports using Tailwind responsive `hidden md:block` class

- [#442](https://github.com/Action-Llama/action-llama/pull/442) [`4fac722`](https://github.com/Action-Llama/action-llama/commit/4fac722de6b16559508863c7d63979619a077711) Thanks [@asselstine](https://github.com/asselstine)! - Update navbar for mobile: show "AL" instead of "Action Llama", icon-only nav links with larger icons on mobile. Add standalone "Agents" page heading and remove title from agents table header.

- [`48e1f14`](https://github.com/Action-Llama/action-llama/commit/48e1f140882445e812129cca7acf6d0991d1c3cb) Thanks [@asselstine](https://github.com/asselstine)! - Throttle SSE status stream (max 2/sec) and debounce invalidation-driven refetches (1s) to prevent 429 errors from rapid-fire updates during active agent runs.

## 0.17.2

### Patch Changes

- [#424](https://github.com/Action-Llama/action-llama/pull/424) [`a7237db`](https://github.com/Action-Llama/action-llama/commit/a7237db1d96929a47f73cc2bf3a21801d7def484) Thanks [@asselstine](https://github.com/asselstine)! - Add immediate spinner feedback to Kill buttons across Dashboard, Agent Detail, and Instance Detail pages. Buttons are now disabled with a spinning indicator the moment they are clicked, preventing double-clicks and providing visual feedback that the kill is in progress.

## 0.17.1

### Patch Changes

- [#415](https://github.com/Action-Llama/action-llama/pull/415) [`9dadab2`](https://github.com/Action-Llama/action-llama/commit/9dadab27114e14940877cd1279938a4c56cb0ec4) Thanks [@asselstine](https://github.com/asselstine)! - Show full instance ID in h1 and add copy-to-clipboard button on instance detail page
