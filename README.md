![Transferencia por QR Code](docs/assets/transferencia-qr-banner.png)

# Transferência por QR Code

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-2f855a?style=flat-square)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-102030?style=flat-square)](LICENSE)
[![Deploy no Render](https://img.shields.io/badge/Deploy-Render-2364aa?style=flat-square)](https://transferencia-qr.onrender.com/)

Transfira arquivos pelo navegador usando QR Code. O celular pode enviar arquivos para o computador, e o computador também pode gerar um QR Code para o celular baixar um ou vários arquivos.

O projeto funciona em dois modos:

- **Local:** ideal para arquivos grandes, usando a rede Wi-Fi entre celular e computador.
- **Hospedado:** prático para testes e arquivos menores, usando o servidor online como ponte temporária.

## Demonstração

Acesse a versão hospedada:

[https://transferencia-qr.onrender.com/](https://transferencia-qr.onrender.com/)

Na versão online, cada navegador que abre o painel recebe um QR Code próprio. Os arquivos enviados por aquele QR aparecem apenas naquela sessão, evitando que outras pessoas vejam seus downloads.

Se você abrir o mesmo link **no celular**, verá uma tela de envio (não o painel do PC), com opção de **ler o QR Code pela câmera** ou colar o link manualmente. No computador, use `/?desktop=1` se precisar forçar o painel de recebimento em um celular.

## Recursos

- **Sessão exclusiva:** QR Code único e PIN de segurança, com renovação ou encerramento a qualquer momento.
- **Envio para o PC:** um ou vários arquivos em fila, com preservação de subpastas.
- **Compartilhamento do PC para o celular:** selecione arquivos/pastas ou arraste e solte; um QR Code é gerado para o celular baixar.
- **Bloco de notas:** sincronizado em tempo real entre computador e celular, com botão para copiar o texto.
- **Sugestões:** atalho discreto no rodapé que abre uma Issue do GitHub já preenchida para o dono receber ideias de melhoria.
- **Conexão por QR ou link:** página mobile com leitura pela câmera ou colagem manual do link.
- **Progresso completo:** barra com velocidade e tempo restante, resultado com tempo total e média, prévia de imagens recebidas, e notificação sonora ao terminar.
- **Transferência resiliente:** retomada automática em caso de queda de internet, botão para parar ou descartar o envio.
- **Painel do computador:** status visual da sessão, lista de aparelhos conectados, histórico de recebidos ampliado, tema claro/escuro salvo, e escolha da pasta de destino (modo local).
- **Hospedado:** download pelo navegador; ideal para arquivos pequenos/médios sem instalação.

## Instalação Local

Requisitos:

- [Node.js](https://nodejs.org/) 18 ou superior
- Computador e celular na mesma rede Wi-Fi

Clone o projeto e instale as dependências:

```powershell
git clone https://github.com/tomaziu/transferencia-qr.git
cd transferencia-qr
npm install
```

Inicie o servidor:

```powershell
npm start
```

Depois abra no computador:

```text
http://localhost:3000
```

No Windows, também é possível iniciar pelo `start.bat` depois de instalar as dependências.

## Uso

Receber arquivos do celular:

1. Abra o painel no computador.
2. Escaneie o QR Code com o celular.
3. Digite no celular o PIN mostrado no computador.
4. Selecione um ou mais arquivos, ou uma pasta quando o navegador permitir.
5. Toque em **Enviar**.
6. Acompanhe o progresso no computador.
7. Baixe o arquivo recebido ou, no modo local, confira a pasta configurada.
8. Ao selecionar pasta, as subpastas são recriadas dentro do destino quando o app roda localmente.

Enviar arquivos do PC para o celular:

1. No painel do computador, use **Enviar para celular**.
2. Selecione um ou mais arquivos do PC, uma pasta quando o navegador permitir, ou arraste arquivos/pastas para a área indicada.
3. Clique em **Gerar QR**.
4. Escaneie o novo QR Code com o celular.
5. Toque em **Baixar tudo (.zip)** para manter pastas/subpastas ou baixe cada item da lista separadamente.

Por padrão, os arquivos recebidos localmente ficam na pasta `recebidos`.
No painel local, use o botão de pasta em **Destino** para escolher outro local de salvamento.

Bloco de notas compartilhado:

1. Abra o painel no computador.
2. Escaneie o QR Code no celular.
3. Digite no bloco de notas em qualquer um dos dois.
4. O texto aparece na outra tela automaticamente.

## Arquivos Grandes

Para arquivos grandes, prefira rodar localmente:

- No modo local, o arquivo passa pela sua rede Wi-Fi até o computador.
- No Render grátis, o arquivo precisa passar pela hospedagem e pode falhar se o serviço dormir, reiniciar ou ficar sem espaço temporário.
- O envio é feito em partes de 1 MB, então uma queda de internet pode ser retomada selecionando o mesmo arquivo novamente.

Referência prática:

| Tamanho | Melhor opção | Observação |
| --- | --- | --- |
| Até 500 MB | Local ou hospedado | Hospedado pode funcionar, mas local é mais estável. |
| 1 GB a 5 GB | Local | Use Wi-Fi estável e mantenha as telas abertas. |
| 10 GB ou mais | Local | Recomendado usar PC no cabo de rede e impedir suspensão. |

## Privacidade

Cada painel aberto cria uma sessão própria:

- O QR Code de uma sessão não é igual ao de outra.
- O celular precisa validar o PIN mostrado no computador antes de enviar arquivos ou sincronizar o bloco de notas.
- O histórico de recebidos é filtrado por sessão.
- O link de download também pertence à sessão que recebeu o arquivo.
- **Renovar QR** invalida o QR/PIN antigos.
- **Encerrar sessão** gera um novo QR/PIN e limpa links antigos daquela sessão.

Ainda assim, na versão hospedada os arquivos passam pelo servidor temporário. Para arquivos privados ou muito grandes, rode localmente no seu próprio computador.

## Solução de Problemas

Se o celular não abrir o link:

- Confirme se celular e computador estão na mesma rede Wi-Fi.
- Permita o acesso do Node.js no Firewall do Windows.
- Tente usar o endereço IP exibido no painel.
- Evite VPN ou rede convidada, porque elas podem bloquear comunicação local.

Se o envio ficar lento:

- Aproxime celular e computador do roteador.
- Prefira Wi-Fi 5 GHz quando houver bom sinal.
- Evite bloquear a tela do celular durante o envio.
- No PC, desative suspensão enquanto estiver recebendo arquivos grandes.

## Desenvolvimento

```powershell
npm start
npm test
```

Arquivos principais:

- `server.js`: servidor HTTP e composição das rotas principais.
- `src/routes.js`: roteamento HTTP do app.
- `src/sessions.js`: identificação de aparelhos e estado público de conexão.
- `src/uploads.js`: helpers de uploads, IDs e prévias de imagem.
- `src/share.js`: helpers de compartilhamento do PC para o celular.
- `src/zip.js`: geração de downloads `.zip`.
- `public/app.js`: painel do computador.
- `public/send.js`: tela do celular para enviar arquivos.
- `public/share.js`: tela do celular para baixar arquivos enviados pelo PC.
- `public/styles.css`: estilos da interface.

## Contribuição

Contribuições são bem-vindas. Leia [CONTRIBUTING.md](CONTRIBUTING.md) antes de abrir um pull request.

Para reportar vulnerabilidades, siga [SECURITY.md](SECURITY.md).

## Licença

Este projeto está licenciado sob a [MIT License](LICENSE).
