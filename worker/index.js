/** Serves the static site. Kept as a Worker so headers or redirects can be added in one place. */
export default {
  async fetch(request, env) {
    return env.ASSETS.fetch(request);
  },
};
