---
name: innoprospect-uso-proprio
description: Decisão travada do dono (2026-09-22) — InnoProspect é de uso próprio; D3 encerrada, D9 aceita em definitivo, e o que isso NÃO relaxa
metadata:
  type: project
---

**Decisão do dono, 2026-09-22: o InnoProspect NÃO será vendido para clientes.** Uso próprio, dados de
um único dono, poucos operadores internos. Registrado em `ARQUITETURA.md §0.1` (v1.2) e na tabela de
decisões §11 (A23).

**Why:** o dono fechou a "Decisão em aberto nº 1" do `PROGRESSO.md`, que era a mais estrutural do
projeto — dela dependiam conta por cliente, isolamento de dados, planos e cobrança.

**How to apply:**
- É restrição de contorno, no mesmo nível de "scraping próprio" e "Evolution API". **Não reabrir**, e
  não propor `orgId`/escopo por organização "só para preparar" — preparar terreno para requisito
  cancelado é custo puro.
- **D3 (multi-tenancy) está ENCERRADA, não adiada.** `ownerId` no `Lead` sobrevive como atribuição de
  responsável entre operadores, nunca como fronteira de segurança.
- **D9 (sem model de configuração) está ACEITA em definitivo.** `APP_COMPANY_NAME` por env é a
  resposta certa para uma empresa só; redeploy para trocar o nome do remetente é evento raro.

**O erro de leitura que eu preciso evitar (e impedir nos outros agentes): "uso próprio" ≠ "pode
relaxar".** Continuam valendo integralmente, e por motivos que não têm nada a ver com modelo de
negócio:
- **Auth/authz** — o domínio é público na internet; "poucos usuários" muda quantos são, não a exposição.
- **LGPD** — o titular do dado é o **lead**, não o cliente do software. Quem prospecta em nome próprio
  é controlador igual.
- **Anti-ban** — o número que cai é o do próprio dono.
- **Papéis `admin`/`operator`** — remover opt-out exige `admin` porque é perigoso, não porque é "de
  outro cliente".

Efeito prático na Fase 4: nenhuma campanha tem escopo por organização; `GET /campaigns` lista tudo e
qualquer `operator` opera qualquer campanha. Isso **simplifica** a fase de verdade.

Relacionado: [[innoprospect-escopo]], [[innoprospect-fase4-motor]].
