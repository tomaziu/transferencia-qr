# Changelog

Todas as mudanças importantes deste projeto serão documentadas neste arquivo.

O formato segue [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
e este projeto adota [Versionamento Semântico](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-05-26

### Adicionado

- Envio de arquivos do computador para o celular por QR Code.
- Suporte a vários arquivos no envio do computador para o celular, com QR Code único e lista de downloads no celular.
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
