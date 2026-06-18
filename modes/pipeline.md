# Modo: pipeline — Inbox de URLs (Second Brain)

Procesa URLs de ofertas acumuladas en `data/pipeline.md`. El usuario agrega URLs cuando quiera y luego ejecuta `/trajecktory pipeline` para procesarlas todas.

## Workflow

0. **REQUIRED — Liveness gate first.** Before doing anything else, run `node gate-pipeline.mjs` in Bash. This Playwright-checks every pending URL and flips dead postings to `- [!]` with a closure reason. Without this step, you waste Claude tokens evaluating expired postings (WebSearch indexes are often months stale — recent batches were ~80% dead). After the gate runs, report the live/dead counts to the user so they know what's about to be evaluated. Then proceed.

1. **Leer** `data/pipeline.md` → buscar items `- [ ]` en la sección "Pendientes" (the gate has already filtered out dead URLs in step 0 — those are now `- [!]` and skipped)
2. **Para cada URL pendiente**:
   a. Calcular siguiente `REPORT_NUM` secuencial (leer `reports/`, tomar el número más alto + 1)
   b. **Extraer JD** usando Playwright (browser_navigate + browser_snapshot) → WebFetch → WebSearch
   c. Si la URL no es accesible → marcar como `- [!]` con nota y continuar
   d. **Ejecutar auto-pipeline completo**: Evaluación A-F → Report .md → PDF (si score >= 3.0) → Tracker
   e. **Mover de "Pendientes" a "Procesadas"**: `- [x] #NNN | URL | Empresa | Rol | Score/5 | PDF ✅/❌`
3. **Si hay 3+ URLs pendientes**, lanzar agentes en paralelo (Agent tool con `run_in_background`) para maximizar velocidad.
4. **Al terminar**, mostrar tabla resumen:

```
| # | Empresa | Rol | Score | PDF | Acción recomendada |
```

5. **Push notification** — after the summary table, send a push notification:
   - Format: `"Pipeline done: {N} evaluated — {top company} {top score}🟢[, {2nd}...] | run /trajecktory apply to proceed"`
   - List up to 3 highest-scoring roles (≥4.0) in the message
   - If nothing scored ≥4.0: `"Pipeline done: {N} evaluated — no strong matches (best: {score})"`
   - Keep under 160 characters. Use PushNotification tool with status: "proactive".

## Formato de pipeline.md

```markdown
## Pendientes
- [ ] https://jobs.example.com/posting/123
- [ ] https://boards.greenhouse.io/company/jobs/456 | Company Inc | Senior PM
- [!] https://private.url/job — Error: login required

## Procesadas
- [x] #143 | https://jobs.example.com/posting/789 | Acme Corp | AI PM | 4.2/5 | PDF ✅
- [x] #144 | https://boards.greenhouse.io/xyz/jobs/012 | BigCo | SA | 2.1/5 | PDF ❌
```

## Detección inteligente de JD desde URL

**Modo interactivo (sesión principal):**
1. **Playwright (preferido):** `browser_navigate` + `browser_snapshot`. Funciona con todas las SPAs.
2. **WebFetch (fallback):** Para páginas estáticas o cuando Playwright no está disponible.
3. **WebSearch (último recurso):** Buscar en portales secundarios que indexan el JD.

**Modo batch (agentes en background):** Los agentes en background no heredan los permisos de la sesión principal y WebFetch puede ser bloqueado. Usar este orden:
1. **WebSearch (primary):** `"{company} {role}" site:{domain}` o `"{company} {role}" careers job description`. Alcanza el 95%+ de postings vía índices.
2. **WebFetch (fallback):** Solo si WebSearch no devuelve el JD completo y la URL es HTML estático directo.
3. Si ninguno funciona: marcar `[!]` con nota y continuar.

**Casos especiales:**
- **LinkedIn**: Puede requerir login → marcar `[!]` y pedir al usuario que pegue el texto
- **PDF**: Si la URL apunta a un PDF, leerlo directamente con Read tool
- **`local:` prefix**: Leer el archivo local. Ejemplo: `local:jds/linkedin-pm-ai.md` → leer `jds/linkedin-pm-ai.md`

## Numeración automática

1. Listar todos los archivos en `reports/`
2. Extraer el número del prefijo (e.g., `142-medispend...` → 142)
3. Nuevo número = máximo encontrado + 1

## Sincronización de fuentes

Antes de procesar cualquier URL, verificar sync:
```bash
node cv-sync-check.mjs
```
Si hay desincronización, advertir al usuario antes de continuar.
