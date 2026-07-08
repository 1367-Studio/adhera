# Prompt para recriar os formulários Cerfa como PDFs preenchíveis (AcroForm)

Cole isso numa IA/ferramenta que gere ou edite PDFs (ex: Adobe Acrobat com "Prepare Form" assistido por IA, ou uma IA de geração de documentos). O objetivo é recriar os dois formulários oficiais franceses abaixo como PDFs com **campos de formulário (AcroForm) preenchíveis, nomeados de forma única e semântica** — sem nomes de campo duplicados/reaproveitados entre diferentes checkboxes ou inputs, e sem um único campo controlando mais de uma caixinha visual ao mesmo tempo.

---

## Documento 1 — Cerfa 11580*05 (reçu dons personnes physiques, "2041-RD")

Reproduza fielmente o layout e o texto do formulário oficial francês **Cerfa n° 11580*05** — "Reçu des dons et versements effectués par les particuliers au titre des articles 200 et 978 du code général des impôts" (também conhecido como "2041-RD"). É um documento de 1 página, A4, com estas seções e campos:

- Cabeçalho: título, referência aos artigos 200/978 do CGI, "N° Cerfa : 11580*05", campo "Numéro d'ordre du reçu"
- Seção "Organisme bénéficiaire des dons et versements": Nom ou dénomination, Numéro SIREN ou RNA, Adresse (N°, Rue, Code postal, Commune, Pays), Objet
- Lista de ~20 categorias jurídicas do organismo, cada uma com **sua própria checkbox independente** (nunca reaproveitar nome de campo entre categorias diferentes), incluindo sub-opções da primeira categoria ("intérêt général": Association loi 1901 / RUP / Fondation universitaire / Fondation d'entreprise / Musée de France / aide alimentaire / Autres — cada sub-opção com checkbox própria e independente)
- Seção "Donateur": Nom, Prénom, Adresse
- Seção detalhe do don: Montant (numérico), Date du versement, Nature du don (checkbox: Versement / autre), Forme du don (checkbox: Don manuel / Acte authentique / autre)
- Bloco de assinatura: Fait à ___, le ___, Signature et cachet de l'association

## Documento 2 — Cerfa 16216*03 (reçu dons entreprises, "2041-MEC-SD")

Reproduza fielmente o **Cerfa n° 16216*03** — "Reçu des dons et versements effectués par les entreprises au titre de l'article 238 bis du code général des impôts" ("2041-MEC-SD"). 2 páginas, A4:

- Cabeçalho: título, "Article 238 bis du CGI", "N° Cerfa : 16216*03", "Numéro d'ordre du reçu"
- Seção "Organisme bénéficiaire des dons et versements": Dénomination, Numéro SIREN ou RNA, Adresse (N°, Rue, Code postal, Commune, Pays), Objet
- Lista de 21 categorias jurídicas do organismo (mesma lista de conteúdo do documento 1, com pequenas variações de texto próprias do 238 bis), cada uma com checkbox **própria e independente**, incluindo as 7 sub-opções da primeira categoria
- Seção "Entreprise donatrice": Dénomination, Forme juridique, Numéro SIREN, Adresse (N°, Rue, Code postal, Commune)
- Seção "Dons et versements effectués par l'entreprise":
  - Dons en nature: valeur en euros, valeur en toutes lettres, description exhaustive (área de texto multi-linha)
  - Versements: valeur en euros, valeur en toutes lettres
  - **Forme des versements**: 4 checkboxes **independentes** (Remise d'espèces / Chèque / Virement, prélèvement ou carte bancaire / Autre) — importante: essas 4 caixinhas não podem compartilhar campo com nenhuma das categorias do organismo listadas acima
  - Montant total des dons et versements: valeur em euros, valeur en toutes lettres
  - Date ou période des dons et versements
- Bloco de assinatura: "Le ___" (data)

---

## Requisitos técnicos (aplicam-se aos dois documentos)

1. **AcroForm real**, com um campo por elemento visual — nunca dois checkboxes visuais diferentes compartilhando o mesmo nome/objeto de campo interno, mesmo que estejam em páginas diferentes.
2. Nomes de campo **semânticos e em inglês ou francês legível** (ex: `organisme_nom`, `organisme_siren`, `categorie_association_loi_1901`, `versement_forme_virement`), não códigos genéricos tipo `a1`, `b14`, `CAC4`.
3. Cada checkbox deve ter valor "ligado" padrão (`/Yes` ou similar) consistente — não usar múltiplos valores diferentes (`/1`, `/2`, `/A`...) pro mesmo nome de campo.
4. Manter o layout visual o mais fiel possível ao Cerfa oficial (é um documento fiscal francês real, precisa parecer com o original).
5. Formato de saída: PDF, fonte não criptografada, sem JavaScript embutido.

Se a ferramenta permitir, gere os dois arquivos separadamente: `2041-rd-preenchivel.pdf` e `2041-mec-sd-preenchivel.pdf`.
