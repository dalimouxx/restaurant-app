/*
 * Quel poste cette page installe-t-elle ?
 *
 * Ce fichier s'exécute pendant l'analyse de la page, avant React et
 * avant tout le reste. C'est délibéré : le navigateur décide de ce
 * qu'il installera au tout début du chargement, d'après le manifeste
 * présent à cet instant. Un manifeste posé après coup par l'application
 * le trouve déjà fixé — et c'est ainsi qu'on installait « Gestion »
 * pour se retrouver devant l'écran client.
 *
 * **Un fichier plutôt qu'un script en ligne**, parce que la politique
 * de sécurité de la page n'autorise que les scripts de même origine :
 * un `<script>` écrit dans le HTML est bloqué sans un mot, et on met
 * une soirée à comprendre pourquoi rien ne se passe.
 *
 * Il ne dépend de rien et ne doit jamais rien attendre.
 */
;(function () {
  var POSTES = ['borne', 'caisse', 'cuisine', 'ecran', 'livreur', 'gestion']

  var NOMS = {
    client: 'Commander',
    borne: 'Borne',
    caisse: 'Caisse',
    cuisine: 'Cuisine',
    ecran: 'Écran',
    livreur: 'Livreur',
    gestion: 'Gestion',
  }

  try {
    var chemin = location.pathname
    var poste = 'client'
    for (var i = 0; i < POSTES.length; i++) {
      if (chemin.indexOf('/' + POSTES[i]) === 0) {
        poste = POSTES[i]
        break
      }
    }

    var lien = document.createElement('link')
    lien.rel = 'manifest'
    lien.href = '/manifest-' + poste + '.webmanifest'
    document.head.appendChild(lien)

    /* iOS n'a pas de manifeste : le nom de l'icône vient de cette
       balise. Sans elle, chaque poste installé s'appelait « Service »,
       et sept icônes identiques s'empilaient sur l'écran d'accueil. */
    var titre = document.createElement('meta')
    titre.name = 'apple-mobile-web-app-title'
    titre.content = NOMS[poste] || 'Service'
    document.head.appendChild(titre)
  } catch (e) {
    /* Un navigateur qui refuse tout cela reste parfaitement utilisable :
       il ne proposera simplement pas l'installation. */
  }
})()
