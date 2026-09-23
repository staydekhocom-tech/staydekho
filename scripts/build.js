#!/usr/bin/env node
/* Vercel build step — minifies shared js/css files AND inline <style>/<script>
   blocks in every HTML page before deploy.
   Runs only inside Vercel's ephemeral build container: it overwrites these
   files in that container's checkout, never in the git repo, so the source
   you edit stays fully readable. Paths/references are untouched. */
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const JS_FILES  = ['js/config.js', 'js/api.js', 'js/components.js'];
const CSS_FILES = ['css/style.css'];

for (const file of JS_FILES) {
  const src = fs.readFileSync(file, 'utf8');
  const { code } = esbuild.transformSync(src, { minify: true, loader: 'js', target: 'es2018' });
  fs.writeFileSync(file, code);
  console.log(`[build] minified ${file} (${src.length} -> ${code.length} bytes)`);
}

for (const file of CSS_FILES) {
  const src = fs.readFileSync(file, 'utf8');
  const { code } = esbuild.transformSync(src, { minify: true, loader: 'css' });
  fs.writeFileSync(file, code);
  console.log(`[build] minified ${file} (${src.length} -> ${code.length} bytes)`);
}

// ── Inline <style>/<script> blocks in every HTML page ──────────────────
const STYLE_RE  = /<style(\s[^>]*)?>([\s\S]*?)<\/style>/g;
const SCRIPT_RE = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/g;

const htmlFiles = fs.readdirSync('.').filter(f => f.endsWith('.html'));
for (const file of htmlFiles) {
  let src = fs.readFileSync(file, 'utf8');
  const before = src.length;

  src = src.replace(STYLE_RE, (full, attrs, content) => {
    if (!content.trim()) return full;
    try {
      const { code } = esbuild.transformSync(content, { minify: true, loader: 'css' });
      return `<style${attrs || ''}>${code}</style>`;
    } catch (e) {
      console.warn(`[build] WARN: could not minify a <style> block in ${file}: ${e.message}`);
      return full;
    }
  });

  src = src.replace(SCRIPT_RE, (full, attrs, content) => {
    const a = attrs || '';
    // Skip external scripts (nothing inline), JSON-LD (not JS), and module
    // scripts using import/export syntax esbuild would need extra config for.
    if (/\bsrc\s*=/.test(a) || /application\/ld\+json/.test(a) || !content.trim()) return full;
    try {
      const { code } = esbuild.transformSync(content, { minify: true, loader: 'js', target: 'es2018' });
      return `<script${a}>${code}</script>`;
    } catch (e) {
      console.warn(`[build] WARN: could not minify a <script> block in ${file}: ${e.message}`);
      return full;
    }
  });

  fs.writeFileSync(file, src);
  console.log(`[build] minified inline blocks in ${file} (${before} -> ${src.length} bytes)`);
}
