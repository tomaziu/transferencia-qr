function createShareHelpers({ sanitizeFileName }) {
  function shareFileInfo(session, file) {
    const downloadParams = new URLSearchParams({
      session: session.id,
      id: file.id,
      token: file.downloadToken
    });

    return {
      id: file.id,
      fileName: file.fileName,
      size: file.size,
      createdAt: file.createdAt,
      downloadUrl: `/share/download?${downloadParams.toString()}`
    };
  }

  function shareBundleDownloadUrl(session, bundle) {
    const params = new URLSearchParams({
      session: session.id,
      bundle: bundle.id,
      token: bundle.token
    });

    return `/share/download-bundle?${params.toString()}`;
  }

  function shareBundleZipName(files) {
    const roots = files
      .map((file) => String(file.fileName || "").split(/[\\/]/)[0])
      .filter(Boolean);
    const first = roots[0];
    const sameRoot = first && roots.every((root) => root === first);
    return `${sameRoot ? sanitizeFileName(first) : "arquivos"}-transferencia.zip`;
  }

  return {
    shareFileInfo,
    shareBundleDownloadUrl,
    shareBundleZipName
  };
}

module.exports = {
  createShareHelpers
};
