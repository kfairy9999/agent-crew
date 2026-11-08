import { createApp } from "./app";

const app = createApp();

export default {
  async fetch(request, env, ctx): Promise<Response> {
    void ctx;
    const url = new URL(request.url);
    console.log(JSON.stringify({ message: "request", method: request.method, path: url.pathname }));
    return app.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
