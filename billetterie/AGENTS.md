<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Gotcha — espaces JSX + entités HTML (Turbopack/SWC)

Un nœud de texte JSX qui contient une **entité HTML** (`&nbsp;`, `&apos;`,
`&rsquo;`…) perd son **espace de tête** au build. Un espace écrit juste après une
balise inline (`</strong> texte… &nbsp;:`) est donc **supprimé** → mots collés
dans le rendu. Écris les espaces **adjacents à une balise inline** en `{' '}`
(les nœuds sans entité gardent leur espace normalement). Pour vérifier : rends la
page et cherche `</strong>` collé à une lettre (`grep -oE "</strong>[A-Za-z]"`).
