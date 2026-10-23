#!/usr/bin/env node
/*
 * Toute couleur employée existe-t-elle ?
 *
 * Tailwind laisse tomber en silence une classe dont le jeton n'existe
 * pas : `text-saffron-400` sans `--color-saffron-400` ne produit aucune
 * règle, aucune erreur, aucun avertissement. La couleur retombe alors
 * sur celle du parent.
 *
 * Ça s'est vu : l'icône du bandeau hors ligne sortait en noir sur fond
 * noir — invisible, et rigoureusement indétectable autrement qu'à
 * l'œil, sur ce seul écran, dans ce seul état. Une rampe à trous est un
 * piège à retardement.
 *
 *   usage :  node scripts/verifier-palette.mjs
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const racine = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')

const css = readFileSync(join(racine, 'index.css'), 'utf8')
const definies = new Set(
  [...css.matchAll(/--color-([a-z]+)-(\d+)\s*:/g)].map((m) => `${m[1]}-${m[2]}`),
)

/** Les familles dont on surveille les rampes : celles du thème. */
const FAMILLES = [...new Set([...definies].map((n) => n.split('-')[0]))]
const motif = new RegExp(
  `\\b(?:text|bg|border|ring|fill|stroke|from|via|to|decoration|outline|shadow|accent|caret|divide|placeholder)-(${FAMILLES.join('|')})-(\\d+)`,
  'g',
)

function fichiers(dossier) {
  return readdirSync(dossier).flatMap((nom) => {
    const chemin = join(dossier, nom)
    if (statSync(chemin).isDirectory()) return fichiers(chemin)
    return /\.(tsx?|css|html)$/.test(nom) ? [chemin] : []
  })
}

const manquantes = new Map()
for (const chemin of fichiers(racine)) {
  const contenu = readFileSync(chemin, 'utf8')
  for (const m of contenu.matchAll(motif)) {
    const nuance = `${m[1]}-${m[2]}`
    if (definies.has(nuance)) continue
    if (!manquantes.has(nuance)) manquantes.set(nuance, new Set())
    manquantes.get(nuance).add(chemin.slice(racine.length + 1))
  }
}

if (manquantes.size === 0) {
  console.log(`Palette : ${definies.size} nuances definies, toutes celles employees existent.`)
  process.exit(0)
}

console.error('Couleurs employees mais absentes de la palette :\n')
for (const [nuance, lieux] of [...manquantes].sort()) {
  console.error(`  ${nuance}`)
  for (const lieu of [...lieux].sort()) console.error(`      ${lieu}`)
}
console.error(
  '\nTailwind laisse tomber ces classes en silence : la couleur retombe sur\n' +
    'celle du parent, et rien ne le signale. Ajoutez la nuance dans\n' +
    'src/index.css, ou employez une nuance existante.\n',
)
process.exit(1)
