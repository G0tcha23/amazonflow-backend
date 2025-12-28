// Detectar cambios en columna PAGADO y colores amarillos
async function detectarCambiosPagado() {
  try {
    const sheetPrincipal = doc.sheetsByIndex[1];
    const rowsPrincipal = await sheetPrincipal.getRows();
    
    // Verificar colores amarillos en hojas de vendedores
    for (const vendedor of VENDEDORES) {
      const hojaVendedor = doc.sheetsByTitle[vendedor];
      if (!hojaVendedor) continue;
      
      const rowsVendedor = await hojaVendedor.getRows();
      
      for (const rowVendedor of rowsVendedor) {
        const numero = rowVendedor.get('NUMERO');
        
        if (!numero) continue;
        
        // Cargar TODO el rango de la fila para verificar el color
        await hojaVendedor.loadCells(`A${rowVendedor.rowNumber}:M${rowVendedor.rowNumber}`);
        const cell = hojaVendedor.getCell(rowVendedor.rowNumber - 1, 0);
        const bgColor = cell.backgroundColor;
        
        // Detectar si es amarillo (aproximadamente)
        const esAmarillo = bgColor && 
                          bgColor.red > 0.9 && 
                          bgColor.green > 0.9 && 
                          bgColor.blue < 0.3;
        
        if (esAmarillo) {
          const estadoActualVendedor = rowVendedor.get('ESTADO');
          
          // Actualizar estado en hoja vendedor si no es Completado
          if (estadoActualVendedor !== 'Completado') {
            rowVendedor.set('ESTADO', 'Completado');
            rowVendedor.set('PAGADO', 'PAGADO');
            await rowVendedor.save();
            console.log(`🟡 Actualizando estado en ${vendedor}: ${numero} → Completado`);
          }
          
          // Sincronizar con Hoja 2
          const rowPrincipal = rowsPrincipal.find(r => r.get('NUMERO') === numero);
          if (rowPrincipal) {
            const estadoPrincipal = rowPrincipal.get('ESTADO');
            
            // Si Hoja 2 no está en Completado o no es amarillo, sincronizar
            if (estadoPrincipal !== 'Completado') {
              console.log(`🟡 Color amarillo detectado en ${vendedor}: ${numero} - Copiando a Hoja 2`);
              rowPrincipal.set('ESTADO', 'Completado');
              rowPrincipal.set('PAGADO', 'PAGADO');
              await rowPrincipal.save();
              await aplicarColorEstado(sheetPrincipal, rowPrincipal.rowNumber, 'Completado');
            } else {
              // Verificar si Hoja 2 tiene el color amarillo aplicado
              await sheetPrincipal.loadCells(`A${rowPrincipal.rowNumber}:M${rowPrincipal.rowNumber}`);
              const cellPrincipal = sheetPrincipal.getCell(rowPrincipal.rowNumber - 1, 0);
              const bgColorPrincipal = cellPrincipal.backgroundColor;
              
              const esAmarilloPrincipal = bgColorPrincipal && 
                                         bgColorPrincipal.red > 0.9 && 
                                         bgColorPrincipal.green > 0.9 && 
                                         bgColorPrincipal.blue < 0.3;
              
              // Si no es amarillo en Hoja 2, aplicar el color
              if (!esAmarilloPrincipal) {
                console.log(`🟡 Aplicando color amarillo en Hoja 2: ${numero}`);
                await aplicarColorEstado(sheetPrincipal, rowPrincipal.rowNumber, 'Completado');
              }
            }
          }
        }
      }
    }
    
  } catch (error) {
    console.error('❌ Error detectando cambios:', error);
  }
}
