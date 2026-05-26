# Contributing

Thanks for your interest in improving **Transferencia por QR Code**.

## Getting Started

1. Fork the repository.
2. Clone your fork locally.
3. Install dependencies:

   ```powershell
   npm install
   ```

4. Start the app:

   ```powershell
   npm start
   ```

5. Run tests before opening a pull request:

   ```powershell
   npm test
   ```

## Pull Request Guidelines

- Keep changes focused and easy to review.
- Update `README.md` if behavior or setup changes.
- Add or update tests when changing server or upload logic.
- Write commit messages in clear Portuguese or English.
- Do not include generated files, uploads, or local config (`recebidos/`, `transferencia-config.json`).

## Reporting Issues

- Use GitHub Issues for bugs and feature requests.
- For security issues, follow [SECURITY.md](SECURITY.md).

## Code Style

- Match the existing plain Node.js style in `server.js`.
- Keep UI copy in Brazilian Portuguese unless there is a strong reason not to.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
