# Contribuindo

Obrigado pelo interesse em melhorar o **Transferencia por QR Code**.

## Primeiros passos

1. Faça um fork do repositório.
2. Clone o seu fork localmente.
3. Instale as dependências:

   ```powershell
   npm install
   ```

4. Inicie o app:

   ```powershell
   npm start
   ```

5. Rode os testes antes de abrir o pull request:

   ```powershell
   npm test
   ```

## Diretrizes para Pull Request

- Mantenha as mudanças focadas e fáceis de revisar.
- Atualize o `README.md` se houver alteração de comportamento ou setup.
- Adicione ou atualize testes ao alterar lógica do servidor ou do upload.
- Escreva mensagens de commit de forma clara.
- Não inclua arquivos gerados, uploads nem configuração local (`recebidos/`, `transferencia-config.json`).

## Reporte de problemas

- Use GitHub Issues para bugs e melhorias.
- Para falhas de segurança, siga [SECURITY.md](SECURITY.md).

## Estilo de código

- Siga o estilo Node.js já existente em `server.js`.
- Mantenha os textos de interface em português do Brasil, salvo exceções bem justificadas.

## Licença

Ao contribuir, você concorda que suas contribuições serão licenciadas sob a [MIT License](LICENSE).
