"use client"

import type { Config } from "@puckeditor/core"
import { sectionBlock } from "@/components/site/blocks/site-block-section-container"
import { columnsBlock } from "@/components/site/blocks/site-block-columns"
import { spacerBlock } from "@/components/site/blocks/site-block-spacer"
import { headingBlock } from "@/components/site/blocks/site-block-heading"
import { textBlock } from "@/components/site/blocks/site-block-text"
import { imageBlock } from "@/components/site/blocks/site-block-image"
import { buttonsBlock } from "@/components/site/blocks/site-block-buttons"
import { videoBlock } from "@/components/site/blocks/site-block-video"
import { mediaTextBlock } from "@/components/site/blocks/site-block-media-text"
import { bannerBlock } from "@/components/site/blocks/site-block-banner"
import { ctaBannerBlock } from "@/components/site/blocks/site-block-cta-banner"
import { statsBlock } from "@/components/site/blocks/site-block-stats"
import { featuresBlock } from "@/components/site/blocks/site-block-features"
import { testimonialsBlock } from "@/components/site/blocks/site-block-testimonials"
import { teamBlock } from "@/components/site/blocks/site-block-team"
import { faqBlock } from "@/components/site/blocks/site-block-faq"
import { contactBlock } from "@/components/site/blocks/site-block-contact"
import { mapBlock } from "@/components/site/blocks/site-block-map"
import { partnersBlock } from "@/components/site/blocks/site-block-partners"
import { galleryBlock } from "@/components/site/blocks/site-block-gallery"
import { socialLinksBlock } from "@/components/site/blocks/site-block-social-links"
import { colorField, imageField, YES_NO_OPTIONS } from "@/components/site/blocks/site-block-fields"
import { socialLinksField } from "@/components/site/site-social-icons"
import {
  FORM_CTA_STYLE_DEFAULTS, FORM_CTA_STYLE_FIELDS, SiteFormCtaCentered, SiteFormCtaSplit,
} from "@/components/site/blocks/site-block-form-cta"
import { eventsBlock } from "@/components/site/blocks/site-block-events"
import { actualitesBlock } from "@/components/site/blocks/site-block-actualites"
import { boutiqueBlock } from "@/components/site/blocks/site-block-boutique"
import { HandshakeIcon, IdentificationCardIcon } from "@phosphor-icons/react/dist/ssr"
import { SITE_CORNER_OPTIONS, SITE_STYLE_PRESETS, getSiteStyleVars } from "@/components/site/blocks/site-block-theme"
import { readSiteMetadata, type FormBinding } from "@/components/site/blocks/site-block-types"
import { SiteNavbar }            from "@/components/site/site-navbar"
import { SiteFooter }            from "@/components/site/site-footer"
import { SiteHeroSection }       from "@/components/site/sections/site-hero-section"
import { SiteAboutSection }      from "@/components/site/sections/site-about-section"
import { SiteContactSection }    from "@/components/site/sections/site-contact-section"
import { getSiteColorVars } from "@/lib/site-theme"
import { SITE_DEFAULT_FONT, SITE_FONTS, SITE_FONT_KEYS, isSiteFontKey } from "@/lib/site-fonts"
import type { SitePuckComponents, SitePuckRootProps } from "@/lib/site-puck/site-puck-data"
import { cn } from "@/lib/utils"

// FORM-7 Puck trial. Every block renders the exact component the public site renders; Puck
// only adds the fields, the drag and drop, the iframe canvas and the viewports around them.

export type { SitePuckMetadata } from "@/components/site/blocks/site-block-types"

const PREVIEW_MEMBERSHIP_FORM: FormBinding = { slug: "#", title: "Voir la page d'adhésion" }
const PREVIEW_DONATION_FORM: FormBinding   = { slug: "#", title: "" }

const SITE_PRIMARY_COLOR   = "var(--site-primary)"
const SITE_SECONDARY_COLOR = "var(--site-secondary)"

const readMetadata = readSiteMetadata

// Puck hands every render function its own props (puck, editMode) next to the block's fields;
// the section components only take the fields.
const PUCK_OWN_PROP_NAMES = new Set(["id", "puck", "editMode"])

function sectionFieldsOf<RenderProps extends object>(renderProps: RenderProps): Omit<RenderProps, "id" | "puck" | "editMode"> {
  return Object.fromEntries(
    Object.entries(renderProps).filter(([propName]) => !PUCK_OWN_PROP_NAMES.has(propName)),
  ) as Omit<RenderProps, "id" | "puck" | "editMode">
}

export const sitePuckConfig: Config<SitePuckComponents, SitePuckRootProps> = {
  categories: {
    layout:    { title: "Mise en page", components: ["section", "columns", "spacer"] },
    content:   { title: "Contenu", components: ["heading", "text", "image", "buttons", "video", "mediaText"] },
    highlight: { title: "Mise en avant", components: ["banner", "ctaBanner", "stats", "features", "testimonials"] },
    association: {
      title:      "Association",
      components: ["team", "faq", "contactInfo", "map", "partners", "gallery", "socialLinks"],
    },
    formwise:  { title: "Contenu Formwise", components: ["events", "actualites", "dons", "boutique"] },
    // The old sections (hero, about, contact) stay renderable for existing sites but are no
    // longer offered; membership blocks are created from a membership form's Publication step.
    other:     { visible: false },
  },

  root: {
    fields: {
      stylePreset:        {
        type:    "select",
        label:   "Style",
        options: [
          { label: "Personnalisé", value: "" },
          ...SITE_STYLE_PRESETS.map(stylePreset => ({ label: stylePreset.label, value: stylePreset.key })),
        ],
      },
      cornerStyle:        { type: "radio", label: "Coins", options: [...SITE_CORNER_OPTIONS] },
      logoUrl:            imageField("Logo"),
      primaryColor:       colorField("Couleur principale"),
      secondaryColor:     colorField("Couleur secondaire"),
      fontFamily:         {
        type:    "select",
        label:   "Police",
        options: SITE_FONT_KEYS.map(fontKey => ({ label: SITE_FONTS[fontKey].label, value: fontKey })),
      },
      headerBgColor:      colorField("Fond de l'en-tête"),
      headerShowName:     {
        type:    "radio",
        label:   "Nom de l'association dans l'en-tête",
        options: [
          { label: "Automatique (masqué avec un logo)", value: "auto" },
          { label: "Afficher", value: "show" },
          { label: "Masquer", value: "hide" },
        ],
      },
      headerShowMembres:  { type: "radio", label: "Bouton « Se connecter »", options: YES_NO_OPTIONS },
      headerShowRegister: { type: "radio", label: "Bouton « Adhérer »", options: YES_NO_OPTIONS },
      footerText:         { type: "textarea", label: "Texte du pied de page" },
      footerBgColor:      colorField("Fond du pied de page"),
      footerLinks:        {
        type:        "array",
        label:       "Liens du pied de page",
        max:         6,
        arrayFields: { label: { type: "text", label: "Libellé" }, url: { type: "text", label: "Adresse" } },
        getItemSummary: footerLink => footerLink.label || "Lien",
      },
      socialLinks:        socialLinksField("Réseaux sociaux"),
      socialInHeader:     { type: "radio", label: "Réseaux sociaux dans l'en-tête", options: YES_NO_OPTIONS },
      socialInFooter:     { type: "radio", label: "Réseaux sociaux dans le pied de page", options: YES_NO_OPTIONS },
      seo: {
        type:  "object",
        label: "Référencement et partage",
        objectFields: {
          title:       { type: "text", label: "Titre du site (onglet et Google) — vide : nom de l'association" },
          description: { type: "textarea", label: "Description pour Google (160 caractères conseillés)" },
          shareImage:  imageField<string | undefined>("Image de partage (réseaux sociaux, 1200×630)"),
          favicon:     imageField<string | undefined>("Icône de l'onglet (favicon, image carrée)"),
        },
      },
    },
    // Picking a style fills colours, font and corners at once; each stays editable afterwards.
    resolveData: (rootData, { changed }) => {
      const rootProps = rootData.props
      if (!changed.stylePreset || !rootProps) return rootData
      const pickedPreset = SITE_STYLE_PRESETS.find(stylePreset => stylePreset.key === rootProps.stylePreset)
      if (!pickedPreset) return rootData
      return {
        ...rootData,
        props: {
          ...rootProps,
          primaryColor:   pickedPreset.primaryColor,
          secondaryColor: pickedPreset.secondaryColor,
          fontFamily:     pickedPreset.fontFamily,
          cornerStyle:    pickedPreset.cornerStyle,
        },
      }
    },
    render: ({ children, puck, ...rootProps }) => {
      const metadata = readMetadata(puck.metadata)
      const fontKey  = isSiteFontKey(rootProps.fontFamily) ? rootProps.fontFamily : SITE_DEFAULT_FONT
      const font     = SITE_FONTS[fontKey]
      return (
        <div
          className={cn("min-h-full bg-white text-gray-900", font.variable)}
          style={{
            colorScheme: "light",
            fontFamily:  font.cssVar,
            ...getSiteColorVars({ ...rootProps, sections: [] }),
            ...getSiteStyleVars(rootProps.cornerStyle),
          }}
        >
          <SiteNavbar
            name={metadata.associationName}
            logoUrl={rootProps.logoUrl}
            color={SITE_PRIMARY_COLOR}
            secondaryColor={SITE_SECONDARY_COLOR}
            portalSlug={metadata.slug}
            headerBgColor={rootProps.headerBgColor}
            headerShowMembres={rootProps.headerShowMembres}
            headerShowRegister={rootProps.headerShowRegister}
            membershipCta={metadata.membershipCta}
            // Automatic: an uploaded logo already carries the name. Without a logo the name
            // always shows, so the header is never left with only an initial.
            showName={!rootProps.logoUrl || rootProps.headerShowName === "show"}
            socialLinks={rootProps.socialInHeader ? rootProps.socialLinks : []}
          />
          <main>{children}</main>
          <SiteFooter
            name={metadata.associationName}
            footerText={rootProps.footerText}
            footerBgColor={rootProps.footerBgColor}
            footerLinks={rootProps.footerLinks}
            color={SITE_PRIMARY_COLOR}
            // On by default: the footer is where visitors look for them.
            socialLinks={rootProps.socialInFooter === false ? [] : rootProps.socialLinks}
          />
        </div>
      )
    },
  },

  components: {
    section: sectionBlock,
    columns: columnsBlock,
    spacer: spacerBlock,
    heading: headingBlock,
    text: textBlock,
    image: imageBlock,
    buttons: buttonsBlock,
    video: videoBlock,
    mediaText: mediaTextBlock,
    banner: bannerBlock,
    ctaBanner: ctaBannerBlock,
    stats: statsBlock,
    features: featuresBlock,
    testimonials: testimonialsBlock,
    team: teamBlock,
    faq: faqBlock,
    contactInfo: contactBlock,
    map: mapBlock,
    partners: partnersBlock,
    gallery: galleryBlock,
    socialLinks: socialLinksBlock,

    hero: {
      label:        "Bannière (ancienne)",
      defaultProps: { title: "Bienvenue", subtitle: "", heroHeight: "full" },
      fields: {
        title:      { type: "text", label: "Titre", contentEditable: true },
        subtitle:   { type: "textarea", label: "Sous-titre", contentEditable: true },
        image:      imageField("Image"),
        bgColor:    colorField("Couleur de fond"),
        heroHeight: {
          type:    "radio",
          label:   "Hauteur",
          options: [{ label: "Plein écran", value: "full" }, { label: "Demi-écran", value: "half" }],
        },
      },
      render: renderProps => (
        <SiteHeroSection section={{ id: renderProps.id, type: "hero", ...sectionFieldsOf(renderProps) }} color={SITE_PRIMARY_COLOR} />
      ),
    },

    about: {
      label:        "Présentation (ancienne)",
      defaultProps: { title: "Qui sommes-nous ?", content: "" },
      fields: {
        title:   { type: "text", label: "Titre", contentEditable: true },
        // Plain textarea for the trial; the stored content is HTML (see toHtml). A richtext
        // field returns a ReactNode while editing, which SiteAboutSection cannot take yet.
        content: { type: "textarea", label: "Texte" },
      },
      render: renderProps => (
        <SiteAboutSection section={{ id: renderProps.id, type: "about", ...sectionFieldsOf(renderProps) }} />
      ),
    },

    // Formwise content: styled blocks reading live association data (keys kept from the old
    // sections so existing sites map onto them; new options are optional and defaulted).
    events:     eventsBlock,
    actualites: actualitesBlock,
    boutique:   boutiqueBlock,

    membership: {
      label:        "Adhésion",
      defaultProps: { title: "Devenir membre", body: "", ...FORM_CTA_STYLE_DEFAULTS },
      fields: {
        title: { type: "text", label: "Titre", contentEditable: true },
        // Stored HTML, rendered through toHtml(): canvas editing would pass a ReactNode instead.
        body:  { type: "textarea", label: "Texte" },
        ...FORM_CTA_STYLE_FIELDS,
      },
      render: renderProps => {
        const metadata       = readMetadata(renderProps.puck.metadata)
        const membershipForm = metadata.membershipFormBySection[renderProps.id]
          ?? (renderProps.puck.isEditing ? PREVIEW_MEMBERSHIP_FORM : null)
        // Same rule as the public site: no bound membership form, nothing to show.
        if (!membershipForm) return <></>
        const sharedProps = {
          id:          "adhesion",
          title:       renderProps.title || "Rejoindre l'association",
          body:        renderProps.body,
          buttonLabel: membershipForm.title,
          href:        `/${metadata.slug}/adhesion/${membershipForm.slug}`,
          slug:        metadata.slug,
          background:  renderProps.background,
          spacing:     renderProps.spacing,
          width:       renderProps.width,
        }
        if (renderProps.layout && renderProps.layout !== "centered") {
          return (
            <SiteFormCtaSplit
              {...sharedProps}
              layout={renderProps.layout}
              image={renderProps.image}
              imageAlt={renderProps.imageAlt}
              isEditing={renderProps.puck.isEditing}
            />
          )
        }
        return <SiteFormCtaCentered {...sharedProps} icon={<IdentificationCardIcon className="size-10" />} />
      },
    },

    dons: {
      label:        "Dons",
      defaultProps: { title: "Soutenez-nous", body: "", buttonLabel: "", ...FORM_CTA_STYLE_DEFAULTS },
      fields: {
        title:       { type: "text", label: "Titre", contentEditable: true },
        // Stored HTML, rendered through toHtml(): canvas editing would pass a ReactNode instead.
        body:        { type: "textarea", label: "Texte" },
        buttonLabel: { type: "text", label: "Texte du bouton" },
        ...FORM_CTA_STYLE_FIELDS,
      },
      render: renderProps => {
        const metadata     = readMetadata(renderProps.puck.metadata)
        // Same rules as the public site: a site that uses donation forms shows nothing without a
        // bound form; older associations fall back to the standalone donation page.
        const donationForm = metadata.donationFormBySection[renderProps.id]
          ?? (renderProps.puck.isEditing && metadata.usesDonationForms ? PREVIEW_DONATION_FORM : null)
        if (!donationForm && metadata.usesDonationForms) return <></>
        const sharedProps = {
          title:       renderProps.title || "Faire un don",
          body:        renderProps.body,
          buttonLabel: renderProps.buttonLabel?.trim() || "Faire un don",
          href:        donationForm ? `/${metadata.slug}/dons/${donationForm.slug}` : `/portal/${metadata.slug}/don`,
          slug:        metadata.slug,
          note:        metadata.canIssueTaxReceipts ? "Reçu fiscal envoyé automatiquement par e-mail" : undefined,
          background:  renderProps.background,
          spacing:     renderProps.spacing,
          width:       renderProps.width,
        }
        if (renderProps.layout && renderProps.layout !== "centered") {
          return (
            <SiteFormCtaSplit
              {...sharedProps}
              layout={renderProps.layout}
              image={renderProps.image}
              imageAlt={renderProps.imageAlt}
              isEditing={renderProps.puck.isEditing}
            />
          )
        }
        return <SiteFormCtaCentered {...sharedProps} icon={<HandshakeIcon className="size-10" />} />
      },
    },

    contact: {
      label:        "Contact (ancien)",
      defaultProps: { title: "Nous contacter" },
      fields: {
        title: { type: "text", label: "Titre", contentEditable: true },
      },
      render: renderProps => {
        const metadata = readMetadata(renderProps.puck.metadata)
        return (
          <SiteContactSection
            section={{ id: renderProps.id, type: "contact", ...sectionFieldsOf(renderProps) }}
            city={metadata.city}
            country={metadata.country}
          />
        )
      },
    },
  },
}
