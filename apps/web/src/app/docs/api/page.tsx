export default function PublicApiDocsPage() {
  return (
    <main className="space-y-3">
      <iframe
        title="Family Chores Swagger UI"
        className="min-h-[78vh] w-full rounded-xl border border-slate-200 bg-white"
        srcDoc={`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
    <style>body{margin:0;background:#fff}.swagger-ui .topbar{display:none}</style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>
      window.onload = () => SwaggerUIBundle({
        url: "/api/docs/openapi.json",
        dom_id: "#swagger-ui",
        persistAuthorization: true
      });
    </script>
  </body>
</html>`}
      />
      <p className="small mt-3">
        Raw OpenAPI JSON: <a href="/api/docs/openapi.json">/api/docs/openapi.json</a>
      </p>
    </main>
  );
}
