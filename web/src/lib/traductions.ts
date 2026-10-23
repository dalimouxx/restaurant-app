import { useLangue, langue as langueCourante, type Langue } from './langue'

/**
 * Les mots de l'application, côté client.
 *
 * **Des clés courtes et parlantes, pas la phrase française.** Prendre le
 * texte français comme clé semble économique jusqu'à la première
 * correction de faute de frappe, qui casse silencieusement la traduction
 * arabe. Une clé est un nom stable ; le français est une traduction
 * comme une autre.
 *
 * **L'arabe est écrit, pas calqué.** « Commander en ligne » ne se rend
 * pas par trois mots arabes mis bout à bout. Les tournures choisies
 * sont celles qu'on lit sur une devanture à Gabès, pas celles d'un
 * traducteur automatique.
 *
 * **Ce qui n'est pas ici.** Le nom des plats, leur description et le nom
 * des zones de livraison viennent de la base, tels que le gérant les a
 * saisis. Les traduire d'office serait inventer sa carte à sa place.
 * Chaque produit porte en revanche un nom arabe facultatif, affiché
 * quand il est rempli — voir `nomTraduit` plus bas.
 */

type Cle = keyof typeof FR

const FR = {
  /* ───────────────── Vitrine ───────────────── */
  'vitrine.commander': 'Commander',
  'vitrine.commanderEnLigne': 'Commander en ligne',
  'vitrine.ouvert': 'Ouvert maintenant',
  'vitrine.ferme': 'Fermé',
  'vitrine.fermeOuvreA': 'Fermé — ouvre à',
  'vitrine.accroche':
    'Commandez depuis votre téléphone, suivez la préparation en direct, et venez récupérer',
  'vitrine.accrocheLivraison': ' — ou on vous livre',
  'vitrine.aujourdhui': "Aujourd'hui",
  'vitrine.livraison': 'Livraison',
  'vitrine.livraisonDes': 'dès',
  'vitrine.retraitSeul': 'Retrait seul',
  'vitrine.alaCarte': 'À la carte',
  'vitrine.plats': 'plats',
  'vitrine.cequonSert': "Ce qu'on sert",
  'vitrine.touteLaCarte': 'Toute la carte',
  'vitrine.voirLaCarte': 'Voir la carte',
  'vitrine.mesCommandes': 'Mes commandes',
  'vitrine.commentCaMarche': 'Comment ça marche',
  'vitrine.etape1': 'Vous commandez',
  'vitrine.etape1d': 'Depuis votre téléphone, en deux minutes. Pas de compte obligatoire.',
  'vitrine.etape2': 'On prépare',
  'vitrine.etape2d': 'Votre ticket part directement en cuisine. Vous suivez l\'avancement en direct.',
  'vitrine.etape3': "C'est prêt",
  'vitrine.etape3d': 'Votre numéro s\'affiche en salle. Vous payez sur place, à la réception.',
  'vitrine.nousTrouver': 'Nous trouver',
  'vitrine.onLivreDans': 'On livre dans',
  'vitrine.horaires': 'Horaires',
  'vitrine.espacePersonnel': 'Espace personnel',
  'vitrine.min': 'min',

  /* ───────────────── Jours ───────────────── */
  'jour.lun': 'Lundi',
  'jour.mar': 'Mardi',
  'jour.mer': 'Mercredi',
  'jour.jeu': 'Jeudi',
  'jour.ven': 'Vendredi',
  'jour.sam': 'Samedi',
  'jour.dim': 'Dimanche',

  /* ───────────────── Commande en ligne ───────────────── */
  'carte.titre': 'Notre carte',
  'carte.sousTitre': 'Retrait sur place ou livraison, paiement à la réception',
  'carte.ajouter': 'Ajouter',
  'carte.voirLePanier': 'Voir le panier',
  'carte.panier': 'Panier',
  'carte.vide': 'Votre panier est vide',
  'carte.total': 'Total',
  'carte.sousTotal': 'Sous-total',
  'carte.fraisLivraison': 'Frais de livraison',
  'carte.commander': 'Commander',
  'carte.retrait': 'Retrait sur place',
  'carte.livrer': 'Livraison',
  'carte.livraisonSuspendue': 'Livraison indisponible pour le moment',
  'carte.votreNom': 'Votre nom',
  'carte.votreTelephone': 'Votre téléphone',
  'carte.adresse': 'Adresse de livraison',
  'carte.zone': 'Zone',
  'carte.note': 'Une précision pour la cuisine ?',
  'carte.envoyer': 'Envoyer la commande',
  'carte.indisponible': 'Indisponible',
  'carte.accueil': 'Accueil',
  'carte.rienIci': 'Rien dans cette catégorie',
  'carte.ferme': 'Nous sommes fermés pour le moment.',
  'carte.reouverture': 'Réouverture',
  'carte.a': 'à',
  'carte.fermeMaisComposez':
    "Vous pouvez composer votre commande, elle sera acceptée à l'ouverture.",
  'carte.continuerAchats': 'Continuer mes achats',
  'carte.confirmer': 'Confirmer',
  'carte.retirerUn': 'Retirer un',
  'carte.ajouterUn': 'Ajouter un',
  'carte.jeRecupere': 'Je récupère',
  'carte.votreQuartier': 'Votre quartier',
  'carte.quartierAide': 'Il détermine les frais et le délai',
  'carte.adressePlace': 'Rue, numéro, étage, repère',
  'carte.nomAide': "Pour qu'on vous appelle quand c'est prêt",
  'carte.nomPlace': 'Prénom ou nom',
  'carte.vosCoordonnees': 'Vos coordonnées',
  'carte.continuer': 'Continuer',
  'carte.nom': 'Nom',
  'carte.telephone': 'Téléphone',
  'carte.sansFrais': 'Sans frais',
  'carte.suspendueCeSoir': 'Suspendue ce soir',
  'carte.aucuneZoneOuverte': "Aucune zone de livraison n'est ouverte pour le moment.",
  'carte.livraisonSuspendueLong':
    'La livraison est suspendue en ce moment. Vous pouvez commander et venir récupérer.',
  'carte.pasDeLivraison': "La livraison n'est pas proposée pour le moment. Choisissez « Je récupère ».",
  'carte.ilManque': 'Il manque',
  'carte.pourMinimum': 'pour atteindre le minimum de',
  'carte.localisation': 'Localisation…',
  'carte.positionPartagee': 'Position partagée avec le livreur',
  'carte.partagerPosition': 'Partager ma position GPS',
  'carte.positionAide': 'La position aide le livreur à vous trouver et à calculer son trajet.',
  'carte.votreTel': 'Votre téléphone',
  'carte.telAideCompte': "Pour vous prévenir quand c'est prêt",
  'carte.telAideInvite': 'Obligatoire — pour vous joindre si besoin',
  'carte.votreNom2': 'Votre nom',
  'carte.minimum': 'min',
  'carte.paiementReception':
    'Paiement à la réception. Vous pourrez ajouter un pourboire une fois la commande passée.',
  'carte.epuise': "Épuisé pour aujourd'hui",

  /* ───────────────── Suivi ───────────────── */
  'suivi.titre': 'Votre commande',
  'suivi.recue': 'Reçue',
  'suivi.enPreparation': 'En préparation',
  'suivi.prete': 'Prête',
  'suivi.enRoute': 'En route',
  'suivi.livree': 'Livrée',
  'suivi.merci': 'Merci !',
  'suivi.pourboire': 'Un pourboire pour le livreur ?',
  'suivi.pourboireDetail': 'Le pourboire lui revient en totalité.',
  'suivi.remercier': 'Remercier le livreur',
  'suivi.introuvable': 'Commande introuvable',
  'suivi.retour': 'Retour',
  'suivi.codeReception': 'Code de réception',
  'suivi.detail': 'Détail',
  'suivi.pourboireLigne': 'Pourboire',
  'suivi.enCuisine': 'En cuisine',
  'suivi.preparation': 'Préparation',
  'suivi.preteARecuperer': 'Prête à récupérer',
  'suivi.enLivraison': 'En livraison',
  'reprise.enCours': 'est en cours',
  'reprise.votreCommande': 'Votre commande',
  'reprise.reprenez': "Reprenez le suivi là où vous l'aviez laissé.",
  'reprise.suivre': 'Suivre',
  'reprise.masquer': 'Masquer',

  /* ───────────────── Borne du comptoir ───────────────── */
  'borne.titre': 'Composez votre commande',
  'borne.consigne': "Touchez un plat pour l'ajouter.",
  'borne.paieCaisse': 'Vous paierez en caisse.',
  'borne.paieRemise': 'Vous paierez à la remise.',
  'borne.votreCommande': 'Votre commande',
  'borne.panierVide': 'Panier vide',
  'borne.panierVideAide': 'Vos plats apparaîtront ici.',
  'borne.surPlace': 'Sur place',
  'borne.aEmporter': 'À emporter',
  'borne.presentezEnCaisse': 'Présentez ce numéro en caisse',
  'borne.gardezCeNumero': 'Gardez ce numéro',
  'borne.demarreApresPaiement': 'Votre préparation démarre dès le paiement.',
  'borne.dejaCommencee': 'Votre préparation a déjà commencé.',
  'borne.enregistree': 'Commande enregistrée',
  'borne.nouvelleCommande': 'Nouvelle commande',

  /* ───────────────── Écran de salle ───────────────── */
  'salle.pretes': 'Prêtes',
  'salle.aucunePrete': 'Aucune commande prête',
  'salle.consigne': "Votre numéro s'affiche en vert quand votre commande est prête",

  /* ───────────────── Installation ───────────────── */
  'install.raccourci': 'Raccourci',
  'install.surVotreEcran': "Sur votre écran d'accueil",
  'install.argument': "Une icône, zéro adresse à retaper, et ça s'ouvre en plein écran.",
  'install.installer': 'Installer',
  'install.plusTard': 'Plus tard',
  'install.fermer': 'Fermer',
} as const

/**
 * L'arabe. Une clé absente retombe sur le français : un mot non traduit
 * vaut mieux qu'un trou ou qu'une cle brute a l'ecran.
 */
const AR: Partial<Record<Cle, string>> = {
  'vitrine.commander': 'اطلب',
  'vitrine.commanderEnLigne': 'اطلب أونلاين',
  'vitrine.ouvert': 'مفتوح الآن',
  'vitrine.ferme': 'مغلق',
  'vitrine.fermeOuvreA': 'مغلق — يفتح على',
  'vitrine.accroche':
    'اطلب من تليفونك، تابع التحضير مباشرة، وتعدّى تاخذ طلبك',
  'vitrine.accrocheLivraison': ' — ولا نوصّلولك',
  'vitrine.aujourdhui': 'اليوم',
  'vitrine.livraison': 'التوصيل',
  'vitrine.livraisonDes': 'من',
  'vitrine.retraitSeul': 'الاستلام فقط',
  'vitrine.alaCarte': 'القائمة',
  'vitrine.plats': 'طبق',
  'vitrine.cequonSert': 'شنوّة نقدّمو',
  'vitrine.touteLaCarte': 'القائمة الكاملة',
  'vitrine.voirLaCarte': 'شوف القائمة',
  'vitrine.mesCommandes': 'طلباتي',
  'vitrine.commentCaMarche': 'كيفاش تخدم',
  'vitrine.etape1': 'تطلب',
  'vitrine.etape1d': 'من تليفونك، في دقيقتين. من غير حساب.',
  'vitrine.etape2': 'نحضّرو',
  'vitrine.etape2d': 'طلبك يمشي مباشرة للمطبخ، وتتابع التحضير في الوقت الحقيقي.',
  'vitrine.etape3': 'جاهز',
  'vitrine.etape3d': 'نمرتك تظهر في القاعة. تخلّص في المحل، عند الاستقبال.',
  'vitrine.nousTrouver': 'وين نلقاونا',
  'vitrine.onLivreDans': 'نوصّلو في',
  'vitrine.horaires': 'أوقات العمل',
  'vitrine.espacePersonnel': 'فضاء العاملين',
  'vitrine.min': 'د',

  'jour.lun': 'الاثنين',
  'jour.mar': 'الثلاثاء',
  'jour.mer': 'الأربعاء',
  'jour.jeu': 'الخميس',
  'jour.ven': 'الجمعة',
  'jour.sam': 'السبت',
  'jour.dim': 'الأحد',

  'carte.titre': 'قائمتنا',
  'carte.sousTitre': 'استلام في المحل ولا توصيل، الخلاص عند الاستقبال',
  'carte.ajouter': 'زيد',
  'carte.voirLePanier': 'شوف السلّة',
  'carte.panier': 'السلّة',
  'carte.vide': 'سلّتك فارغة',
  'carte.total': 'المجموع',
  'carte.sousTotal': 'المجموع الفرعي',
  'carte.fraisLivraison': 'معلوم التوصيل',
  'carte.commander': 'اطلب',
  'carte.retrait': 'استلام في المحل',
  'carte.livrer': 'توصيل',
  'carte.livraisonSuspendue': 'التوصيل موقّف توّا',
  'carte.votreNom': 'اسمك',
  'carte.votreTelephone': 'نمرة تليفونك',
  'carte.adresse': 'عنوان التوصيل',
  'carte.zone': 'المنطقة',
  'carte.note': 'عندك ملاحظة للمطبخ؟',
  'carte.envoyer': 'ابعث الطلب',
  'carte.indisponible': 'ماهوش موجود',
  'carte.accueil': 'الصفحة الرئيسية',
  'carte.rienIci': 'ما فمّا والو في هذا القسم',
  'carte.ferme': 'مسكّرين توّا.',
  'carte.reouverture': 'نحلّو',
  'carte.a': 'على',
  'carte.fermeMaisComposez': 'تنجّم تحضّر طلبك، ونقبلوه كي نحلّو.',
  'carte.continuerAchats': 'كمّل الطلب',
  'carte.confirmer': 'أكّد',
  'carte.retirerUn': 'نقّص واحد',
  'carte.ajouterUn': 'زيد واحد',
  'carte.jeRecupere': 'نجي ناخذو',
  'carte.votreQuartier': 'الحومة متاعك',
  'carte.quartierAide': 'هي اللي تحدّد المعلوم والوقت',
  'carte.adressePlace': 'الشارع، النمرة، الطابق، علامة',
  'carte.nomAide': 'باش نعيّطولك كي يكون جاهز',
  'carte.nomPlace': 'الاسم ولا اللقب',
  'carte.vosCoordonnees': 'معلوماتك',
  'carte.continuer': 'كمّل',
  'carte.nom': 'الاسم',
  'carte.telephone': 'التليفون',
  'carte.sansFrais': 'بلاش',
  'carte.suspendueCeSoir': 'موقّف هالليلة',
  'carte.aucuneZoneOuverte': 'ما فمّا حتّى منطقة توصيل محلولة توّا.',
  'carte.livraisonSuspendueLong':
    'التوصيل موقّف توّا. تنجّم تطلب وتجي تاخذ طلبك من المحل.',
  'carte.pasDeLivraison': 'التوصيل ماهوش متوفّر توّا. اختار « نجي ناخذو ».',
  'carte.ilManque': 'ينقصك',
  'carte.pourMinimum': 'باش توصل للحدّ الأدنى متاع',
  'carte.localisation': 'نحدّدو موقعك…',
  'carte.positionPartagee': 'موقعك توصّل للموصّل',
  'carte.partagerPosition': 'ابعث موقعك GPS',
  'carte.positionAide': 'الموقع يعاون الموصّل باش يلقاك ويحسب الطريق.',
  'carte.votreTel': 'نمرة تليفونك',
  'carte.telAideCompte': 'باش نعلموك كي يكون جاهز',
  'carte.telAideInvite': 'إجباري — باش نتصلو بيك كان لزم',
  'carte.votreNom2': 'اسمك',
  'carte.minimum': 'الأدنى',
  'carte.paiementReception':
    'الخلاص عند الاستقبال. تنجّم تزيد بقشيش كي يتسجّل الطلب.',
  'carte.epuise': 'سالا اليوم',

  'suivi.titre': 'طلبك',
  'suivi.recue': 'توصّلنا بيه',
  'suivi.enPreparation': 'في التحضير',
  'suivi.prete': 'جاهز',
  'suivi.enRoute': 'في الطريق',
  'suivi.livree': 'توصّل',
  'suivi.merci': 'يعيشك!',
  'suivi.pourboire': 'بقشيش للموصّل؟',
  'suivi.pourboireDetail': 'البقشيش يمشي كامل ليه.',
  'suivi.remercier': 'اشكر الموصّل',
  'suivi.introuvable': 'ما لقيناش الطلب',
  'suivi.retour': 'ارجع',
  'suivi.codeReception': 'كود الاستلام',
  'suivi.detail': 'التفاصيل',
  'suivi.pourboireLigne': 'بقشيش',
  'suivi.enCuisine': 'في المطبخ',
  'suivi.preparation': 'التحضير',
  'suivi.preteARecuperer': 'جاهز للاستلام',
  'suivi.enLivraison': 'في التوصيل',
  'reprise.enCours': 'مازال في الطريق',
  'reprise.votreCommande': 'طلبك',
  'reprise.reprenez': 'كمّل المتابعة من وين وقفت.',
  'reprise.suivre': 'تابع',
  'reprise.masquer': 'أخفي',

  'borne.titre': 'حضّر طلبك',
  'borne.consigne': 'المس الطبق باش تزيدو.',
  'borne.paieCaisse': 'تخلّص في الكياس.',
  'borne.paieRemise': 'تخلّص كي تاخذ طلبك.',
  'borne.votreCommande': 'طلبك',
  'borne.panierVide': 'السلّة فارغة',
  'borne.panierVideAide': 'أطباقك باش تبان هنا.',
  'borne.surPlace': 'في المحل',
  'borne.aEmporter': 'للاخراج',
  'borne.presentezEnCaisse': 'ورّي هالنمرة في الكياس',
  'borne.gardezCeNumero': 'احفظ هالنمرة',
  'borne.demarreApresPaiement': 'التحضير يبدا كي تخلّص.',
  'borne.dejaCommencee': 'التحضير بدا.',
  'borne.enregistree': 'الطلب تسجّل',
  'borne.nouvelleCommande': 'طلب جديد',

  'salle.pretes': 'جاهزة',
  'salle.aucunePrete': 'ما فمّا حتّى طلب جاهز',
  'salle.consigne': 'نمرتك تولّي خضراء كي يكون طلبك جاهز',

  'install.raccourci': 'اختصار',
  'install.surVotreEcran': 'على شاشة تليفونك',
  'install.argument': 'أيقونة وحدة، من غير ما تكتب العنوان، وتتحلّ على الشاشة الكاملة.',
  'install.installer': 'نصّب',
  'install.plusTard': 'مرّة أخرى',
  'install.fermer': 'سكّر',
}

const DICTIONNAIRES: Record<Langue, Partial<Record<Cle, string>>> = { fr: FR, ar: AR }

/** Traduit une clé dans la langue donnée, français par défaut. */
export function traduire(cle: Cle, lang: Langue = langueCourante()): string {
  return DICTIONNAIRES[lang][cle] ?? FR[cle]
}

/** Le traducteur de l'écran courant : il se redessine au changement. */
export function useT(): (cle: Cle) => string {
  const lang = useLangue()
  return (cle: Cle) => traduire(cle, lang)
}

/**
 * Les étapes du suivi, côté client.
 *
 * Elles ne passent pas par `trackingSteps` de `format.ts` : celui-là
 * sert aussi la caisse et la cuisine, et l'équipe travaille en
 * français. Deux vocabulaires pour une même caisse produisent des
 * erreurs de clôture, pas du confort.
 */
export function etapesSuivi(livraison: boolean, lang: Langue = langueCourante()): string[] {
  const e = (c: Cle) => traduire(c, lang)
  return livraison
    ? [
        e('suivi.recue'),
        e('suivi.enCuisine'),
        e('suivi.preparation'),
        e('suivi.prete'),
        e('suivi.enLivraison'),
        e('suivi.livree'),
      ]
    : [
        e('suivi.recue'),
        e('suivi.enCuisine'),
        e('suivi.preparation'),
        e('suivi.preteARecuperer'),
      ]
}

/**
 * Le nom d'un plat ou d'une catégorie dans la langue lue.
 *
 * Le gérant saisit un nom arabe quand il le veut, et seulement s'il le
 * veut. Sans lui, on affiche le nom d'origine — un client qui lit
 * l'arabe reconnaît « Makloub » écrit en latin bien mieux qu'une case
 * vide.
 */
export function nomTraduit(
  item: { name: string; nameAr?: string | null },
  lang: Langue = langueCourante(),
): string {
  if (lang === 'ar' && item.nameAr && item.nameAr.trim()) return item.nameAr
  return item.name
}
