function doGet(e) {
  var page = (e && e.parameter && e.parameter.page) || "studio";
  var routes = {
    studio: "https://kurolab.cc.cd/game-studio/?transport=gas",
    code: "https://kurolab.cc.cd/game-studio/code.html?transport=gas",
    projects: "https://kurolab.cc.cd/game-studio/projects.html?transport=gas",
    games: "https://kurolab.cc.cd/games/?transport=gas"
  };
  var appUrl = routes[page] || routes.studio;
  var template = HtmlService.createTemplateFromFile("Index");
  template.appUrl = appUrl;
  template.activePage = page;
  return template.evaluate()
    .setTitle("KURO GAME STUDIO | GAS")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * GAS-side health endpoint.
 * Supabase API traffic itself is relayed through the existing KURO Worker
 * /api/kuro-gas-proxy endpoint, which forwards requests to this Apps Script
 * deployment using the configured server-side secret.
 */
function doPost(e) {
  return ContentService
    .createTextOutput(JSON.stringify({
      ok: false,
      error: "Use the KURO GAS relay endpoint for Supabase requests."
    }))
    .setMimeType(ContentService.MimeType.JSON);
}
