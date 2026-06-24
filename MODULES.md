# Adhéra — Modules & Roadmap

## Princípio de Modularidade

Cada módulo deve ser **completamente desacoplado**. Isso significa:

- Ativar ou desativar um módulo não quebra o fluxo de nenhum outro
- Nenhum módulo depende de outro estar habilitado para funcionar
- A ativação é controlada por feature flags no nível da `Association` (ex: `modules: string[]` no schema)
- O menu e as rotas se adaptam automaticamente aos módulos ativos
- Dados de um módulo desativado não são apagados — apenas ficam inacessíveis

---

## Status dos Módulos

### Implementados

| Módulo | Descrição | Status |
|--------|-----------|--------|
| Membros | Cadastro, edição, status, filtros, portal do membro | Funcional |
| Eventos | Criação, calendário, presença, RSVP, localização, preço | Funcional |
| Actualités | Publicações, rich text, imagem, destinatários, notificações | Funcional |
| Cotisações | Controle de anuidades por membro, status, exportação | Funcional |
| Tesouraria | Entradas/saídas, categorias, saldo | Funcional |
| Notificações | Push em tempo real via Pusher, sino no header | Funcional |

---

## Módulos a Implementar

### 1. Comunicação Automatizada
**O que é:** Envio automático de e-mails/mensagens com base em gatilhos (evento, pagamento, data).

**Exemplos de gatilhos:**
- Membro cadastrado → e-mail de boas-vindas
- Evento criado → notificação aos membros
- Cotisation vencendo → lembrete automático
- Presença registrada → confirmação

**Componentes necessários:**
- Modelo de mensagem (template com variáveis)
- Motor de regras: `gatilho + condição + ação`
- Fila de envio (ex: jobs com `pg-boss` ou similar)
- Histórico de envios por membro

**Desacoplamento:** Se desativado, o sistema funciona normalmente — apenas sem envios automáticos. Notificações manuais (já existentes) continuam funcionando.

---

### 2. Redação Assistida por IA
**O que é:** Geração e melhoria de textos dentro da plataforma via Claude API.

**Casos de uso:**
- Redigir actualités, e-mails, descrições de eventos
- Melhorar/resumir texto existente no rich text editor
- Gerar sugestões de subject para e-mails

**Componentes necessários:**
- Botão "Assistir com IA" no `RichTextEditor`
- Sidebar/modal de prompt + resposta gerada
- Integração com Claude API (claude-haiku-4-5 para velocidade)

**Desacoplamento:** Botão simplesmente não aparece se o módulo estiver desativado. O editor continua funcional.

---

### 3. Pagamento Online
**O que é:** Integração com gateway para cobrar cotisações, eventos e inscrições.

**Casos de uso:**
- Pagamento de anuidade pelo portal do membro
- Compra de ingresso para evento pago
- Doações

**Componentes necessários:**
- Integração Stripe (Checkout Session ou Payment Links)
- Webhook para confirmar pagamento → atualiza status automaticamente
- Histórico de transações por membro
- Suporte a múltiplas moedas (EUR para FR, BRL opcional)

**Desacoplamento:** Sem o módulo, cotisações e eventos continuam existindo — apenas o fluxo de pagamento online fica indisponível. Pagamento manual (cheque, espèces) continua registrável.

---

### 4. Lembretes Automáticos / Cobranças
**O que é:** Agendamento de mensagens de cobrança baseadas em datas de vencimento.

**Configurações por associação:**
- X dias antes do vencimento → lembrete suave
- No dia → aviso
- X dias após → cobrança com tom mais firme

**Componentes necessários:**
- Configuração de régua de cobrança (admin)
- Cron job que verifica vencimentos diariamente
- Integração com módulo de Comunicação Automatizada (se ativo) ou e-mail direto

**Desacoplamento:** Funciona independentemente do módulo de Pagamento Online. Mesmo sem pagamento online, pode enviar lembrete para pagar por cheque.

---

### 5. Presenças Digitais com QR Code
**O que é:** Check-in em eventos via QR Code, com histórico exportável.

**Fluxo:**
- Admin gera QR Code único por evento
- Membro escaneia na entrada → check-in registrado
- Admin vê lista de presença em tempo real
- Exportação CSV/PDF

**Componentes necessários:**
- Geração de QR Code por evento (ex: `qrcode` lib)
- Página pública de check-in `/check-in/[token]`
- Atualização em tempo real via Pusher (já integrado)
- Exportação da lista

**Desacoplamento:** O módulo de Eventos funciona sem QR Code — presença manual já existe. QR Code é uma camada adicional.

---

### 6. Doações e Recibos Fiscais
**O que é:** Recebimento de doações com geração automática de recibo (Cerfa 11580 para FR).

**Fluxo:**
- Doador faz doação (online via Stripe ou registrada manualmente)
- Sistema gera recibo fiscal em PDF automaticamente
- Recibo enviado por e-mail e disponível no histórico

**Componentes necessários:**
- Formulário de doação (portal ou página pública)
- Geração de PDF (ex: `@react-pdf/renderer` ou `puppeteer`)
- Template de recibo conforme regras fiscais (FR: Cerfa, outros: genérico)
- Histórico de doações

**Desacoplamento:** Totalmente independente de cotisações e eventos. Pode coexistir com o módulo de Pagamento Online (Stripe) ou funcionar só com registro manual.

---

### 7. Gestão de Materiais
**O que é:** Inventário de equipamentos com controle de localização e empréstimos.

**Campos por item:**
- Nome, categoria, número de série, estado
- Localização atual
- Responsável atual (membro)
- Histórico de movimentações/empréstimos

**Componentes necessários:**
- CRUD de itens com categorias
- Fluxo de empréstimo: saída → devolução
- Alertas de item não devolvido
- Geração de QR Code por item (opcional, liga com módulo QR)

**Desacoplamento:** Nenhuma dependência de outros módulos. Funciona de forma completamente isolada.

---

### 8. Site Integrado
**O que é:** Página pública da associação gerada automaticamente a partir dos dados do sistema.

**Seções públicas:**
- Apresentação da associação
- Próximos eventos (puxa do módulo de Eventos)
- Formulário de adesão/inscrição como membro
- Página de doação (se módulo de Doações ativo)
- Área do membro (portal já existente)

**Componentes necessários:**
- Rota pública `/[slug]` por associação
- Editor de conteúdo da página (hero, sobre, links)
- Formulário de candidatura a membro → cria membro com status pendente

**Desacoplamento:** O site mostra apenas as seções cujos módulos estão ativos. Sem módulo de Eventos, a seção de eventos não aparece.

---

### 9. Bilheteria
**O que é:** Venda e controle de ingressos para eventos com QR Code de validação.

**Fluxo:**
- Admin cria tipos de ingresso (gratuito, pago, VIP)
- Membro ou público compra ingresso → recebe QR Code por e-mail
- Na entrada: QR Code escaneado → validado → entrada liberada

**Componentes necessários:**
- Tipos de ingresso por evento (quantidade, preço, data limite)
- Geração de ingresso em PDF com QR Code
- Página de validação para staff (mobile-first)
- Integração com Pagamento Online (se ativo) para ingressos pagos
- Relatório de vendas por evento

**Desacoplamento:** Depende opcionalmente de Pagamento Online (para ingressos pagos), mas funciona sem ele para ingressos gratuitos. O módulo de Eventos continua funcionando sem bilheteria.

---

## Prioridade Sugerida

| Prioridade | Módulo | Justificativa |
|-----------|--------|---------------|
| 1 | Comunicação Automatizada | Base para vários outros módulos |
| 2 | Pagamento Online (Stripe) | Alta demanda, cotisações + eventos |
| 3 | Lembretes Automáticos | Depende de Comunicação |
| 4 | Redação com IA | Diferencial, baixo esforço de infra |
| 5 | QR Code / Presenças | Complementa eventos já existentes |
| 6 | Doações + Recibos | Complementa Pagamento Online |
| 7 | Bilheteria | Complementa Eventos + Pagamento |
| 8 | Site Integrado | Voltado à captação de membros |
| 9 | Gestão de Materiais | Útil mas menos urgente |

---

## Implementação das Feature Flags

Proposta de schema Prisma para controle de módulos:

```prisma
model Association {
  ...
  modules   String[]  @default([])  // ex: ["COMMUNICATION", "PAYMENT", "AI", ...]
}
```

Enum dos módulos disponíveis:

```
COMMUNICATION    → Comunicação Automatizada
AI               → Redação com IA
PAYMENT          → Pagamento Online
REMINDERS        → Lembretes Automáticos
QR_CHECKIN       → QR Code / Presenças Digitais
DONATIONS        → Doações e Recibos
MATERIALS        → Gestão de Materiais
PUBLIC_SITE      → Site Integrado
TICKETING        → Bilheteria
```
