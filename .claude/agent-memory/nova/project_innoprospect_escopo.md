---
name: innoprospect-escopo
description: O que é o InnoProspect, decisões travadas pelo dono e premissas de escala assumidas na arquitetura v1
metadata:
  type: project
---

InnoProspect é uma plataforma de prospecção B2B ativa: busca por nicho + UF → scraping de
Google Maps → Leads num CRM leve com funil → campanhas de WhatsApp com cadência controlada.

**Decisões travadas pelo dono (NÃO reabrir, não sugerir alternativa):**
- Fonte de leads: scraping próprio de Google Maps. Sem Google Places API paga, sem base da Receita.
- WhatsApp: Evolution API (não-oficial, Baileys, QR). Não propor Cloud API oficial.
- Stack: Next.js 15 App Router + TypeScript + Prisma + PostgreSQL; scraper e disparo em processo
  Node separado (fila + execução longa, nunca em route handler serverless).

**Why:** o dono já avaliou custo/benefício dessas escolhas antes de me acionar; reabri-las queima
tokens e confiança.

**How to apply:** ao propor qualquer coisa nesse projeto, tratar esses três pontos como restrições
de contorno, não como espaço de decisão. Espaço de decisão real está em fila, motor de scraping,
auth e organização de código.

**Premissas de escala que declarei na v1 (validar se mudarem):** MVP evoluindo para produto,
1–20 operadores, 10k–500k leads no primeiro ano, dezenas a poucos milhares de msgs/dia,
VPS com Docker Compose (não serverless). Foi isso que justificou monólito modular em 2 processos.

Ver [[innoprospect-arquitetura-v1]] para as decisões técnicas e [[innoprospect-armadilhas]] para
os pontos onde é fácil errar.
