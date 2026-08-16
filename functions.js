export default {
  async fetch(request) {
    return Response.json({
      ok: true,
      name: "pg-bannerwar",
      path: new URL(request.url).pathname,
    });
  },
};
