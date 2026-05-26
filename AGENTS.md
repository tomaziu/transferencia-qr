# AGENTS.md

Orientações para assistentes de IA trabalhando neste repositório.

## Resumo do projeto

**Transferencia por QR Code** é um app web em Node.js para enviar arquivos do celular para o computador na mesma rede local. No computador, o navegador exibe um QR Code; no celular, a página `/send` faz o upload com progresso acompanhado via Server-Sent Events.

## Stack

- **Runtime:** Node.js (sem Express)
- **Frontend:** HTML/CSS/JS estáticos em `public/`
- **Dependência:** apenas `qrcode`
- **Entry point:** `server.js`
- **Início:** `npm start` ou `start.bat` no Windows

## Arquivos principais

| Arquivo | Função |
| --- | --- |
| `server.js` | Servidor HTTP, API de upload, SSE, configuração do QR |
| `public/index.html` + `public/app.js` | UI do computador (recebimento) |
| `public/send.html` + `public/send.js` | UI do celular (envio) |
| `transferencia-config.json` | Pasta de destino salva (ignorada no git) |
| `recebidos/` | Diretório padrão de uploads (ignorado no git) |

## Convenções

- Textos voltados ao usuário ficam em **português do Brasil**.
- Mantenha mudanças mínimas e focadas.
- Prefira estender padrões existentes em vez de adicionar frameworks.
- Ações locais (escolha de pasta, API de destino) devem continuar restritas a requisições loopback via `requireLocalRequest`.
- A segurança do upload depende de um token por sessão no link do QR (`?key=`).

## Variáveis de ambiente

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `PORT` | `3000` | Porta HTTP |
| `RENDER` / `RENDER_*` | — | Detecta comportamento de ambiente hospedado |

## Testes

```bash
npm test
```

Os testes de fumaça em `test/smoke.test.js` sobem o servidor e verificam endpoints HTTP principais.

## Ao alterar a lógica de upload

- O tamanho do chunk é `CHUNK_SIZE` (1 MB) em `server.js`.
- Uploads parciais usam `.upload-*.part` e `.upload-*.json` na pasta de destino.
- Fluxo de retomada: `/upload/start` → `/upload/chunk` → `/upload/finish`.

## Não faça

- Não commite `node_modules/`, `recebidos/` nem `transferencia-config.json`.
- Não quebre a compatibilidade do upload no celular sem atualizar o servidor e `public/send.js`.
- Não remova a validação do token de `/send` ou das rotas de upload.
