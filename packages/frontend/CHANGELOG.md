# @action-llama/frontend

## 0.19.7

### Patch Changes

- [#527](https://github.com/Action-Llama/action-llama/pull/527) [`cd9a865`](https://github.com/Action-Llama/action-llama/commit/cd9a86525ea54df867b9b959b93ef179f9a4f4fd) Thanks [@asselstine](https://github.com/asselstine)! - Fix two instance log bugs: (1) older instance logs no longer disappear — backend `readLastEntries` now scans up to 50k lines instead of stopping at `limit*3`, so sparse instance entries are found even when many newer-instance lines follow; (2) the logs panel pre-fetches one older page on load to provide scroll headroom above the initially visible entries.

## 0.19.6

### Patch Changes

- [#522](https://github.com/Action-Llama/action-llama/pull/522) [`2df5dac`](https://github.com/Action-Llama/action-llama/commit/2df5dace062fc02a41185a38349190541654026a) Thanks [@asselstine](https://github.com/asselstine)! - Breadcrumb no longer shows the current page title, preventing duplicate display with the h1 heading below

- [#506](https://github.com/Action-Llama/action-llama/pull/506) [`29ef738`](https://github.com/Action-Llama/action-llama/commit/29ef738603760fb11ab8f6bced6ed230904812a0) Thanks [@asselstine](https://github.com/asselstine)! - Add backward pagination to instance logs viewer so users can scroll up to load older log entries

- [#517](https://github.com/Action-Llama/action-llama/pull/517) [`ab13c6d`](https://github.com/Action-Llama/action-llama/commit/ab13c6df1da31769e2e6bf22d2b6333489f0e6fe) Thanks [@asselstine](https://github.com/asselstine)! - Move log summary notice to a fixed overlay on top of the log panel so it is always visible regardless of scroll position and must be explicitly closed.

- [#516](https://github.com/Action-Llama/action-llama/pull/516) [`603a586`](https://github.com/Action-Llama/action-llama/commit/603a586d0384c8425749b23268020a20d1a05757) Thanks [@asselstine](https://github.com/asselstine)! - Hide "0 lines" line count indicator in log panel header on mobile viewports

- [#521](https://github.com/Action-Llama/action-llama/pull/521) [`1fc56c8`](https://github.com/Action-Llama/action-llama/commit/1fc56c8e5c6b0847d17be2dc9c63cab2d5cfbbc5) Thanks [@asselstine](https://github.com/asselstine)! - Move status dot and word from beside the agent title to beside "Activity" in the activity panel

- [#505](https://github.com/Action-Llama/action-llama/pull/505) [`8236de6`](https://github.com/Action-Llama/action-llama/commit/8236de6b169139cef7671edd8588e1d90e7fb18d) Thanks [@asselstine](https://github.com/asselstine)! - Replace button-styled "Token Usage" subnav on Stats page with underline tab style matching AgentLayout tabs

## 0.19.5

### Patch Changes

- [#500](https://github.com/Action-Llama/action-llama/pull/500) [`94c26a6`](https://github.com/Action-Llama/action-llama/commit/94c26a6b4475bf40e17b43abd998badfcf0b7d8c) Thanks [@asselstine](https://github.com/asselstine)! - Replace back-arrow navigation with clickable breadcrumbs on agent and instance pages

- [#501](https://github.com/Action-Llama/action-llama/pull/501) [`5bd6379`](https://github.com/Action-Llama/action-llama/commit/5bd63797e97317819f2855cf2aed0206268b3268) Thanks [@asselstine](https://github.com/asselstine)! - Tighten label/value tables on InstanceTriggerPage, TriggerDetailPage, and WebhookReceiptPage by replacing full-width flex justify-between rows with a two-column grid layout, so labels and values sit close together and are easier to read.

## 0.19.4

### Patch Changes

- [#484](https://github.com/Action-Llama/action-llama/pull/484) [`e59a317`](https://github.com/Action-Llama/action-llama/commit/e59a317e22506c49238b0240695729c6fb0eb9c3) Thanks [@asselstine](https://github.com/asselstine)! - Fix activity rows to match agent index page row style: show instance ID in large, bold, colored text on top, with trigger badge below it

- [#491](https://github.com/Action-Llama/action-llama/pull/491) [`3b05804`](https://github.com/Action-Llama/action-llama/commit/3b05804c6dc3e86edb9a3718396a71dbc4024126) Thanks [@asselstine](https://github.com/asselstine)! - Change running state colour from green to blue across agent index, agent detail, instance detail pages and StateBadge component to be consistent with the activity table.

- [#483](https://github.com/Action-Llama/action-llama/pull/483) [`ff8640e`](https://github.com/Action-Llama/action-llama/commit/ff8640e5594fa2b798709dd567b0f13032faabca) Thanks [@asselstine](https://github.com/asselstine)! - Remove logs section from agent page activity tab

## 0.19.3

### Patch Changes

- [#474](https://github.com/Action-Llama/action-llama/pull/474) [`3bb8aff`](https://github.com/Action-Llama/action-llama/commit/3bb8aff566e0b437697bd700a6ed81cf86166086) Thanks [@asselstine](https://github.com/asselstine)! - Fix activity component: show trigger badge for pending rows, display full instance IDs, and make trigger column fit-content width

## 0.19.2

### Patch Changes

- [`3984ef7`](https://github.com/Action-Llama/action-llama/commit/3984ef7554cf995e92375b7736ff89ffc0ade498) Thanks [@asselstine](https://github.com/asselstine)! - Restructure activity table from two columns (Time, Description) to three columns (Time, Trigger, Agent). The Trigger column shows the trigger badge component, and the Agent column shows the colored instance ID linked to the instance detail page. Dead letters omit the agent column. On mobile the agent instance ID stacks underneath the trigger.

- [`4f278d9`](https://github.com/Action-Llama/action-llama/commit/4f278d90d09893630991b0f39eb6e3325b5373e2) Thanks [@asselstine](https://github.com/asselstine)! - Centralize frontend polling into a single `usePolling` hook so that interval management, in-flight guards, abort signals, and cleanup are handled consistently across all pages.

- [`c7ad5a4`](https://github.com/Action-Llama/action-llama/commit/c7ad5a430c00e7b46ab31adba360924bd56b9333) Thanks [@asselstine](https://github.com/asselstine)! - Remove running/scale fraction from dashboard agent status cell, showing only the status dot aligned with the agent name.

- [`414edd4`](https://github.com/Action-Llama/action-llama/commit/414edd43374379ac94c44d452444adf536872c2e) Thanks [@asselstine](https://github.com/asselstine)! - Remove leftover agent color dots from the Activity table description column. Agent names now left-align exactly with the webhook trigger badge below them.

## 0.19.1

### Patch Changes

- [`149d155`](https://github.com/Action-Llama/action-llama/commit/149d15507af12e6d3017a7ea47eaab82ef380a93) Thanks [@asselstine](https://github.com/asselstine)! - Collapse "Instance" and "Trigger" columns into a single "Description" column in the activity table. Agent activity rows now show the agent name with the trigger badge underneath; dead letter rows show only the trigger. Webhook trigger badges now display detailed event info (e.g. "github issues opened" instead of just "github") by enriching activity rows with the webhook receipt's event summary.

- [`32a58c6`](https://github.com/Action-Llama/action-llama/commit/32a58c6fc258e17a80130e3a37e25aa382b146a4) Thanks [@asselstine](https://github.com/asselstine)! - Move agent status dot from inline (next to name) to its own column with a running/available count displayed as a compact fraction. Fixes alignment between agent name and trigger badges.

## 0.19.0

### Minor Changes

- [#471](https://github.com/Action-Llama/action-llama/pull/471) [`3c448cf`](https://github.com/Action-Llama/action-llama/commit/3c448cf6a022f19f5142238b0e6b8484cd1e284d) Thanks [@asselstine](https://github.com/asselstine)! - Refactor agent pages into a tabbed layout with Activity, Stats, and Settings tabs. The agent header (name, state, Run/Kill buttons) is now shared via a new AgentLayout component and stays fixed across all tabs. This eliminates the page title jumping issue and provides cleaner navigation. The /admin route now redirects to /settings.

- [#470](https://github.com/Action-Llama/action-llama/pull/470) [`76b70eb`](https://github.com/Action-Llama/action-llama/commit/76b70ebdec295e6d0e763b34aae5f0de44909831) Thanks [@asselstine](https://github.com/asselstine)! - Add top-level Stats page with per-agent token usage bar charts sorted by highest to lowest usage. Remove token usage bar from Dashboard page.

### Patch Changes

- [#460](https://github.com/Action-Llama/action-llama/pull/460) [`5bfa405`](https://github.com/Action-Llama/action-llama/commit/5bfa4055df89d3a9675105320ece880540c26a5e) Thanks [@asselstine](https://github.com/asselstine)! - Activity page UI tweaks: replace status column with colored dot on timestamp, reorder columns to Time → Instance → Trigger, hide trigger column on mobile with inline display below agent name

- [#469](https://github.com/Action-Llama/action-llama/pull/469) [`97d35cc`](https://github.com/Action-Llama/action-llama/commit/97d35cc403e9bc3c2dee27f7784273ebe6ab37dc) Thanks [@asselstine](https://github.com/asselstine)! - Agent index page: replace State column with inline status dot next to agent name and add row background tinting by state

- [#458](https://github.com/Action-Llama/action-llama/pull/458) [`736732f`](https://github.com/Action-Llama/action-llama/commit/736732f15979eb74dd4a40dc4beee043dede05d1) Thanks [@asselstine](https://github.com/asselstine)! - Remove colored dot indicator from agent name displays throughout the Web UI

- [#463](https://github.com/Action-Llama/action-llama/pull/463) [`18c1eb7`](https://github.com/Action-Llama/action-llama/commit/18c1eb794f431d221121610236eae476e2051d95) Thanks [@asselstine](https://github.com/asselstine)! - Remove the runs table from the agent stats page, keeping only the summary stat cards.

- [#465](https://github.com/Action-Llama/action-llama/pull/465) [`2c9ea22`](https://github.com/Action-Llama/action-llama/commit/2c9ea22d22d8a0d856002cc586bc90930abc7f8a) Thanks [@asselstine](https://github.com/asselstine)! - Unify webhook display: use provider-colored TriggerBadge everywhere

  - Fix webhook trigger source to store provider name (e.g. "github") instead of event type (e.g. "issues") in scheduler, watcher, and execution
  - Fix pending queue item source access in stats route (ctx.context?.source)
  - Add getWebhookSourcesBatch() to StatsStore for enriching historical webhook rows
  - Add "manual" and "agent" color variants to TriggerBadge
  - Refactor ActivityTable to use TriggerBadge (source-colored) instead of TriggerTypeBadge, shared across Activity page and agent detail page

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
