# Dependencias locales de PDF

- jsPDF 4.2.1: `https://registry.npmjs.org/jspdf/-/jspdf-4.2.1.tgz`, archivo `package/dist/jspdf.umd.min.js`.
- jsPDF-AutoTable 5.0.9: `https://registry.npmjs.org/jspdf-autotable/-/jspdf-autotable-5.0.9.tgz`, archivo `package/dist/jspdf.plugin.autotable.min.js`.

Se conservan las licencias MIT en esta carpeta. Las bibliotecas se sirven desde la propia web; los datos del negocio no se envían a servicios de conversión.

`package.json` permite ejecutar las mismas distribuciones UMD en las pruebas de Node. En el navegador se cargan como scripts locales.
