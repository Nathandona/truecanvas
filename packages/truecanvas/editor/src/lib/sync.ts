import { api } from "./api";
import { useStore } from "./store";

let gitTimer = 0;
let reviewKey = "";
let docsChanged = true;

/** An edit happened: the next git refresh also refreshes "what changed". */
export function markDesignChanged() {
  docsChanged = true;
}

/** git status is cheap but not free: coalesce bursts of edits */
export function loadGit(delay = 600) {
  clearTimeout(gitTimer);
  gitTimer = window.setTimeout(() => {
    api
      .gitStatus()
      .then((git) => {
        useStore.setState({ git });
        // "what changed" renders diffs per page: only when files or the design moved
        const key = JSON.stringify(git.files) + git.branch;
        if (git.repo && (docsChanged || key !== reviewKey)) {
          reviewKey = key;
          docsChanged = false;
          void api
            .gitChanges()
            .then(({ pages }) => useStore.setState({ review: pages }))
            .catch(() => {});
        }
        if (!git.repo) useStore.setState({ review: [] });
      })
      .catch(() => {});
  }, delay);
}

let prTimer = 0;
/** Pull request of the current branch (gh), refreshed now and then. */
export function loadPr(fresh = false) {
  clearTimeout(prTimer);
  prTimer = window.setTimeout(() => {
    api
      .gitPr(fresh)
      .then((pr) => useStore.setState({ pr }))
      .catch(() => {});
  }, 50);
}

export function loadComments() {
  const canvas = useStore.getState().canvas;
  if (!canvas) return;
  api
    .comments(canvas)
    .then(({ threads }) => useStore.getState().canvas === canvas && useStore.setState({ threads }))
    .catch(() => {});
}
