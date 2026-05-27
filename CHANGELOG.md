# Changelog

Todas as mudanças importantes deste projeto serão documentadas neste arquivo.

O formato segue [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
e este projeto adota [Versionamento Semântico](https://semver.org/spec/v2.0.0.html).

## [1.3.0] - 2026-05-26

### Adicionado

- Lista de aparelhos conectados com identificação básica por navegador/dispositivo.
- Prévia de imagens recebidas no histórico para JPG, PNG e WebP.
- Resumo para listas grandes de arquivos enviados do PC para o celular, com total, tamanho combinado e opção de expandir/recolher.
- Status visual da sessão com QR, PIN e tempo desde a criação.
- Aviso sonoro e notificação do navegador ao concluir transferências.

### Melhorado

- Código de rotas, sessões e geração de ZIP separado em módulos dentro de `src/`.
- Testes de fumaça cobrem prévia de imagem e lista de aparelhos conectados.

## [1.2.0] - 2026-05-26

### Adicionado

- PIN de segurança por sessão antes de liberar a tela do celular.
- Botões para renovar o QR Code, encerrar sessão e limpar histórico.
- Aviso de celular conectado/desconectado no painel do computador.
- Botão para copiar o texto do bloco de notas no computador e no celular.
- Arrastar e soltar arquivos ou pastas na área de envio do PC para o celular.
- Tema claro/escuro com preferência salva no navegador.
- Tempo total e velocidade média ao concluir envios.

### Melhorado

- Rotas de upload, bloco de notas e eventos do celular agora exigem token validado pelo PIN.
- Testes de fumaça cobrem PIN, renovação de QR e limpeza de histórico.

## [1.1.0] - 2026-05-26

### Adicionado

- Envio de arquivos do computador para o celular por QR Code.
- Suporte a vários arquivos no envio do computador para o celular, com QR Code único e lista de downloads no celular.
- Seleção de pasta no envio do celular e do computador, preservando subpastas por caminho relativo ou ZIP.
- Bloco de notas compartilhado em tempo real entre computador e celular.
- QR Code exclusivo por navegador/sessão, evitando que downloads de uma pessoa apareçam para outra.
- Aviso visual quando o QR Code de envio do celular expira.
- Botão para parar um envio em andamento.
- Opção de descartar envio salvo apenas quando houver falha ou pausa.
- Avisos sobre arquivos grandes em MB/GB.
- Crédito visual do criador do projeto no site.

### Melhorado

- Downloads recebidos na versão hospedada ficaram mais claros, sem mostrar destino local que não se aplica ao navegador.
- README atualizado com instruções, privacidade, arquivos grandes e link da hospedagem.
- Testes de fumaça ampliados para cobrir o compartilhamento do PC para o celular.

## [1.0.0] - 2026-05-25

### Adicionado

- Transferência de arquivos do celular para o computador na mesma rede Wi-Fi.
- Geração de QR Code para acesso rápido no celular.
- Progresso de upload em tempo real no painel do computador.
- Upload em partes com retomada.
- Escolha da pasta de destino no computador.
- Suporte a demonstração hospedada com downloads temporários no servidor.
