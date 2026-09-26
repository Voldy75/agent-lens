'use strict';
const fs = require('fs');
const path = require('path');
const { layout } = require('./layout');
const { validate } = require('./validate');

const TEMPLATE = path.join(__dirname, 'template.html');

// JSON embedded in a <script> must not be able to close it.
const safeJson = (o) => JSON.stringify(o)
  .replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
  .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

function renderToFile(rawState, outFile, opts = {}) {
  const { state, warnings } = validate(rawState);
  const placed = layout(state);

  const rendered = { ...state, districts: placed.districts, modules: placed.modules };
  delete rendered.layout;
  // meta is internal bookkeeping; the one piece the page shows is lifted out.
  if (rendered.meta && rendered.meta.planTip) rendered.planTip = rendered.meta.planTip;
  delete rendered.meta;

  const build = {
    version: opts.version || '',
    generatedAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
    warnings: [...(opts.warnings || []), ...warnings].slice(0, 8)
  };

  const html = fs.readFileSync(TEMPLATE, 'utf8')
    .replace('__TITLE__', `Agent Lens — ${String(state.project.name).replace(/[<>]/g, '')}`)
    .replace(/\/\*__STATE__\*\/[\s\S]*?\/\*__END__\*\//, safeJson(rendered))
    .replace(/\/\*__BUILD__\*\/[\s\S]*?\/\*__ENDBUILD__\*\//, safeJson(build));

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, html);
  return { bytes: html.length, pinned: placed.pinned, warnings: build.warnings };
}

module.exports = { renderToFile };
