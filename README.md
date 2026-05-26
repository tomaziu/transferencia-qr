![Transferencia por QR Code](docs/assets/transferencia-qr-banner.png)

# Transferencia por QR Code

App local para receber arquivos do celular pela mesma rede Wi-Fi, com QR Code e barra de progresso em tempo real.

## Instalação

Requisitos:

- [Node.js](https://nodejs.org/) 18 ou superior
- Computador e celular na mesma rede Wi-Fi

Passos:

```powershell
git clone https://github.com/tomaziu/transferencia-qr.git
cd transferencia-qr
npm install
```

No Windows, você também pode usar `start.bat` depois de instalar as dependências.

## Uso

1. Inicie o app:

   ```powershell
   npm start
   ```

2. Abra `http://localhost:3000` no computador.
3. Escaneie o QR Code com o celular.
4. Escolha os arquivos no celular e envie.
5. Acompanhe o progresso no painel do computador.

Por padrão, os arquivos recebidos ficam na pasta `recebidos`.
No painel do computador, use o botão de pasta em **Destino** para escolher outro local de salvamento.

O envio é feito em partes. Se a conexão cair, selecione o mesmo arquivo de novo e toque em **Enviar** para continuar de onde parou, enquanto o servidor ainda estiver rodando.

Se o celular não conseguir abrir o link, confirme se computador e celular estão no mesmo Wi-Fi e permita o acesso do Node.js no Firewall do Windows.

## Site hospedado

Versão online de demonstração:

https://transferencia-qr.onrender.com/

Na versão hospedada, os arquivos ficam temporariamente no servidor e aparecem com um botão de download na lista **Recebidos**.
Cada navegador que abre o painel recebe um QR Code proprio; os envios feitos por esse QR aparecem apenas naquela sessao.

## Desenvolvimento

```powershell
npm start   # inicia o servidor
npm test    # executa os testes de fumaça
```

Consulte [AGENTS.md](AGENTS.md) para orientações úteis a ferramentas de IA e [CONTRIBUTING.md](CONTRIBUTING.md) para contribuir com o projeto.

## Contribuição

Contribuições são bem-vindas. Leia [CONTRIBUTING.md](CONTRIBUTING.md) antes de abrir um pull request.

## Segurança

Para reportar vulnerabilidades, siga [SECURITY.md](SECURITY.md).

## Licença

Este projeto está licenciado sob a [MIT License](LICENSE).

## Changelog

Veja [CHANGELOG.md](CHANGELOG.md) para o histórico de versões.
