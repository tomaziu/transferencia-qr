![Transferencia por QR Code](docs/assets/transferencia-qr-banner.png)

# Transferencia por QR Code

App local para receber arquivos do celular pela mesma rede Wi-Fi.

## Site hospedado

Acesse a versao online em:

https://transferencia-qr.onrender.com/

## Como usar

1. Instale as dependencias:

   ```powershell
   npm install
   ```

2. Inicie o app:

   ```powershell
   npm start
   ```

3. Abra `http://localhost:3000` no computador.
4. Escaneie o QR Code com o celular.
5. Escolha os arquivos no celular e envie.

Por padrao, os arquivos recebidos ficam na pasta `recebidos`.
No painel do computador, use o botao de pasta em **Destino** para escolher outro local de salvamento.
Na versao hospedada em um servidor, os arquivos ficam temporariamente no servidor e aparecem com um botao de download na lista **Recebidos**.
O envio e feito em partes. Se a conexao cair, selecione o mesmo arquivo de novo e toque em **Enviar** para continuar de onde parou, enquanto o servidor ainda estiver rodando.

Se o celular nao conseguir abrir o link, confirme se computador e celular estao no mesmo Wi-Fi e permita o acesso do Node.js no Firewall do Windows.
