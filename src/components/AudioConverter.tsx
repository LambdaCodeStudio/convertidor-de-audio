import React, { useState, useRef, useEffect } from 'react';

const AudioConverter = () => {
  const [files, setFiles] = useState([]);
  const [converting, setConverting] = useState(false);
  const [progress, setProgress] = useState({});
  const [convertedFiles, setConvertedFiles] = useState([]);
  const [format, setFormat] = useState('mp3');
  const [message, setMessage] = useState('');
  const fileInputRef = useRef(null);
  const workersRef = useRef([]);
  
  // Controles para el paralelismo
  const [maxWorkers, setMaxWorkers] = useState(4); // Por defecto 4 workers
  const [cpuCores, setCpuCores] = useState(navigator.hardwareConcurrency || 4);
  
  // Para seguimiento del progreso total
  const [totalProgress, setTotalProgress] = useState(0);
  const [filesProcessed, setFilesProcessed] = useState(0);
  const [processingFiles, setProcessingFiles] = useState([]);
  const [processingQueue, setProcessingQueue] = useState([]);
  
  // Para medir rendimiento
  const [startTime, setStartTime] = useState(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const timerRef = useRef(null);

  // Detectar núcleos disponibles al cargar
  useEffect(() => {
    const cores = navigator.hardwareConcurrency || 4;
    setCpuCores(cores);
    
    // Establecer un valor predeterminado razonable basado en los núcleos disponibles
    // Usamos aproximadamente el 75% de los núcleos disponibles
    const defaultWorkers = Math.max(2, Math.floor(cores * 0.75));
    setMaxWorkers(defaultWorkers);
  }, []);
  
  // Timer para tiempo transcurrido
  useEffect(() => {
    if (converting && startTime) {
      timerRef.current = setInterval(() => {
        setElapsedTime(Math.floor((Date.now() - startTime) / 1000));
      }, 1000);
    } else if (!converting) {
      clearInterval(timerRef.current);
    }
    
    return () => clearInterval(timerRef.current);
  }, [converting, startTime]);

  // Función para crear el código del worker
  const createWorkerCode = () => {
    return `
      self.importScripts('https://cdnjs.cloudflare.com/ajax/libs/lamejs/1.2.0/lame.min.js');
      
      self.onmessage = function(e) {
        const { audioData, sampleRate, format, fileName, fileIndex, workerId } = e.data;
        
        if (format === 'mp3') {
          // Configurar el codificador MP3
          const mp3encoder = new lamejs.Mp3Encoder(1, sampleRate, 128);
          const mp3Data = [];
          
          // Convertir audio a enteros cortos para lamejs
          const samples = new Int16Array(audioData.length);
          for (let i = 0; i < audioData.length; i++) {
            const s = Math.max(-1, Math.min(1, audioData[i]));
            samples[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
          }
          
          // Procesar en bloques para reportar progreso
          const blockSize = 1152;
          for (let i = 0; i < samples.length; i += blockSize) {
            const sampleChunk = samples.subarray(i, i + blockSize);
            const mp3buf = mp3encoder.encodeBuffer(sampleChunk);
            if (mp3buf.length > 0) {
              mp3Data.push(mp3buf);
            }
            
            // Reportar progreso
            if (i % (blockSize * 10) === 0) {
              self.postMessage({ 
                type: 'progress', 
                progress: i / samples.length,
                fileIndex: fileIndex,
                workerId: workerId
              });
            }
          }
          
          // Finalizar la codificación
          const mp3buf = mp3encoder.flush();
          if (mp3buf.length > 0) {
            mp3Data.push(mp3buf);
          }
          
          // Enviar los datos codificados
          self.postMessage({ 
            type: 'complete', 
            data: mp3Data,
            format: 'mp3',
            fileName: fileName,
            fileIndex: fileIndex,
            workerId: workerId
          });
        } else if (format === 'wav') {
          // Codificación WAV (mucho más simple)
          const wavData = encodeWAV(audioData, sampleRate);
          self.postMessage({ 
            type: 'complete', 
            data: [wavData],
            format: 'wav',
            fileName: fileName,
            fileIndex: fileIndex,
            workerId: workerId
          });
        }
      };
      
      // Función para codificar en WAV
      function encodeWAV(samples, sampleRate) {
        const buffer = new ArrayBuffer(44 + samples.length * 2);
        const view = new DataView(buffer);
        
        // Encabezado WAV
        writeString(view, 0, 'RIFF');
        view.setUint32(4, 36 + samples.length * 2, true);
        writeString(view, 8, 'WAVE');
        writeString(view, 12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, 1, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * 2, true);
        view.setUint16(32, 2, true);
        view.setUint16(34, 16, true);
        writeString(view, 36, 'data');
        view.setUint32(40, samples.length * 2, true);
        
        // Escribir muestras
        floatTo16BitPCM(view, 44, samples);
        
        return buffer;
      }
      
      function writeString(view, offset, string) {
        for (let i = 0; i < string.length; i++) {
          view.setUint8(offset + i, string.charCodeAt(i));
        }
      }
      
      function floatTo16BitPCM(output, offset, input) {
        for (let i = 0; i < input.length; i++, offset += 2) {
          const s = Math.max(-1, Math.min(1, input[i]));
          output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        }
      }
    `;
  };

  useEffect(() => {
    // Limpieza al desmontar
    return () => {
      // Terminar todos los workers
      workersRef.current.forEach(worker => {
        if (worker) worker.terminate();
      });
      workersRef.current = [];
    };
  }, []);

  // Inicializar workers cuando se necesiten
  const initializeWorkers = () => {
    // Limpiar workers anteriores si existen
    workersRef.current.forEach(worker => {
      if (worker) worker.terminate();
    });
    
    workersRef.current = [];
    
    // Crear nuevos workers
    for (let i = 0; i < maxWorkers; i++) {
      const workerCode = createWorkerCode();
      const blob = new Blob([workerCode], { type: 'application/javascript' });
      const worker = new Worker(URL.createObjectURL(blob));
      
      worker.onmessage = handleWorkerMessage;
      workersRef.current.push(worker);
    }
  };

  const handleWorkerMessage = (e) => {
    const { type, progress, data, format, fileName, fileIndex, workerId } = e.data;
    
    if (type === 'progress') {
      // Actualizar el progreso de este archivo específico
      setProgress(prev => ({
        ...prev,
        [fileIndex]: progress * 100
      }));
    } else if (type === 'complete') {
      // Crear Blob desde los datos codificados
      const blob = new Blob(data, { 
        type: format === 'mp3' ? 'audio/mp3' : 'audio/wav' 
      });
      
      // Obtener nombre base del archivo original
      const originalName = fileName || `audio_${fileIndex}`;
      // Eliminar la extensión original
      const baseName = originalName.replace(/\.[^/.]+$/, '');
      // Crear nuevo nombre con la extensión correcta
      const newFileName = `${baseName}.${format}`;
      
      setConvertedFiles(prev => [...prev, {
        blob,
        url: URL.createObjectURL(blob),
        name: newFileName,
        format,
        originalIndex: fileIndex
      }]);
      
      // Actualizar contador de archivos procesados
      setFilesProcessed(prev => prev + 1);
      
      // Actualizar el progreso total
      setTotalProgress(prev => {
        const newProgress = ((filesProcessed + 1) / files.length) * 100;
        return Math.min(newProgress, 100);
      });
      
      // Eliminar este archivo de la lista de procesamiento
      setProcessingFiles(prev => 
        prev.filter(pFile => pFile.index !== fileIndex)
      );
      
      // Verificar si hemos terminado con todos los archivos
      if (filesProcessed + 1 >= files.length) {
        setConverting(false);
        setMessage('¡Conversión completada!');
      } else {
        // Procesar el siguiente archivo de la cola si hay alguno
        processNextFileInQueue(workerId);
      }
    }
  };
  
  // Procesar el siguiente archivo en la cola usando el worker específico
  const processNextFileInQueue = (workerId) => {
    setProcessingQueue(prevQueue => {
      if (prevQueue.length === 0) return prevQueue;
      
      // Tomar el siguiente archivo de la cola
      const nextFile = prevQueue[0];
      const newQueue = prevQueue.slice(1);
      
      // Agregar a archivos en procesamiento
      setProcessingFiles(prev => [...prev, {
        name: nextFile.file.name,
        index: nextFile.index
      }]);
      
      // Iniciar la conversión de este archivo
      convertFile(nextFile.file, nextFile.index, workerId);
      
      return newQueue;
    });
  };

  const handleFileChange = (e) => {
    const selectedFiles = Array.from(e.target.files);
    setFiles(selectedFiles);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const droppedFiles = Array.from(e.dataTransfer.files);
    setFiles(droppedFiles);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const convertFile = async (file, index, workerId) => {
    try {
      // Leer el archivo como ArrayBuffer
      const arrayBuffer = await file.arrayBuffer();
      
      // Crear contexto de audio para decodificar
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const audioData = await audioContext.decodeAudioData(arrayBuffer);
      
      // Extraer datos del canal (usamos mono para simplificar)
      const channelData = audioData.getChannelData(0);
      
      // Enviar al worker para procesamiento en segundo plano
      workersRef.current[workerId].postMessage({
        audioData: channelData,
        sampleRate: audioData.sampleRate,
        format,
        fileName: file.name,
        fileIndex: index,
        workerId
      });
    } catch (error) {
      console.error(`Error al convertir el archivo ${file.name}:`, error);
      setMessage(`Error con ${file.name}: ${error.message}`);
      
      // Actualizar contador de archivos procesados
      setFilesProcessed(prev => prev + 1);
      
      // Eliminar este archivo de la lista de procesamiento
      setProcessingFiles(prev => 
        prev.filter(pFile => pFile.index !== index)
      );
      
      // Procesar el siguiente archivo en la cola
      processNextFileInQueue(workerId);
      
      // Verificar si hemos terminado con todos los archivos
      if (filesProcessed + 1 >= files.length) {
        setConverting(false);
        setMessage('Conversión completada con algunos errores');
      }
    }
  };

  const handleConvert = () => {
    if (files.length > 0) {
      // Inicializar y limpiar el estado
      setConvertedFiles([]);
      setConverting(true);
      setTotalProgress(0);
      setFilesProcessed(0);
      setProgress({});
      setProcessingFiles([]);
      setStartTime(Date.now());
      setElapsedTime(0);
      
      // Inicializar workers
      initializeWorkers();
      
      // Crear la cola inicial de archivos
      const initialQueue = files.map((file, index) => ({ file, index }));
      
      // Tomar los primeros archivos para procesamiento inmediato (hasta maxWorkers)
      const initialProcessing = initialQueue.slice(0, maxWorkers);
      const remainingQueue = initialQueue.slice(maxWorkers);
      
      setProcessingQueue(remainingQueue);
      
      // Comenzar a procesar los archivos iniciales
      initialProcessing.forEach((item, workerIndex) => {
        setProcessingFiles(prev => [...prev, {
          name: item.file.name,
          index: item.index
        }]);
        
        convertFile(item.file, item.index, workerIndex);
      });
    }
  };

  const triggerFileInput = () => {
    fileInputRef.current.click();
  };

  const removeFile = (index) => {
    setFiles(prevFiles => prevFiles.filter((_, i) => i !== index));
  };

  const removeAllFiles = () => {
    setFiles([]);
  };

  // Calcular el progreso promedio de todos los archivos en procesamiento
  const calculateAverageProgress = () => {
    if (processingFiles.length === 0) return 0;
    
    let totalProgressSum = 0;
    let filesWithProgress = 0;
    
    processingFiles.forEach(file => {
      if (progress[file.index] !== undefined) {
        totalProgressSum += progress[file.index];
        filesWithProgress++;
      }
    });
    
    return filesWithProgress > 0 ? totalProgressSum / filesWithProgress : 0;
  };
  
  // Estimar tiempo restante
  const estimateRemainingTime = () => {
    if (!converting || filesProcessed === 0 || elapsedTime === 0) return 'Calculando...';
    
    const filesRemaining = files.length - filesProcessed;
    const timePerFile = elapsedTime / filesProcessed;
    const remainingSeconds = Math.round(timePerFile * filesRemaining);
    
    // Formatear en minutos y segundos
    if (remainingSeconds < 60) {
      return `${remainingSeconds} segundos`;
    } else {
      const minutes = Math.floor(remainingSeconds / 60);
      const seconds = remainingSeconds % 60;
      return `${minutes} min ${seconds} seg`;
    }
  };
  
  // Calcular velocidad de conversión
  const calculateConversionRate = () => {
    if (filesProcessed === 0 || elapsedTime === 0) return '0';
    return (filesProcessed / elapsedTime).toFixed(2);
  };

  return (
    <div className="max-w-4xl mx-auto p-6 bg-white rounded-lg shadow-lg">
      <h1 className="text-3xl font-bold text-center mb-6 text-blue-700">Convertidor de Audio</h1>
      
      {/* Área de arrastrar y soltar */}
      <div 
        className="border-2 border-dashed border-blue-400 rounded-lg p-8 text-center mb-6 cursor-pointer hover:bg-blue-50 transition"
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onClick={triggerFileInput}
      >
        <input 
          type="file" 
          ref={fileInputRef}
          className="hidden" 
          accept="audio/*" 
          onChange={handleFileChange}
          multiple
        />
        <div className="text-gray-500 mb-2">
          {files.length > 0 ? (
            <div className="text-blue-700">{files.length} archivo(s) seleccionado(s)</div>
          ) : (
            <div>
              <p className="text-lg">Arrastra y suelta archivos de audio aquí</p>
              <p className="text-sm my-2">o</p>
              <button className="bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 transition">
                Seleccionar archivos
              </button>
            </div>
          )}
        </div>
      </div>
      
      {/* Lista de archivos */}
      {files.length > 0 && (
        <div className="mb-6">
          <div className="flex justify-between items-center mb-2">
            <h2 className="text-lg font-semibold">Archivos seleccionados:</h2>
            <button 
              onClick={removeAllFiles}
              className="text-red-600 text-sm hover:text-red-800"
              disabled={converting}
            >
              Eliminar todos
            </button>
          </div>
          <ul className="bg-gray-50 rounded-md p-2 max-h-60 overflow-y-auto">
            {files.map((file, index) => (
              <li key={index} className="p-2 border-b border-gray-200 last:border-0">
                <div className="flex justify-between items-center">
                  <span className="font-medium truncate mr-2">{file.name}</span>
                  <div className="flex items-center">
                    <span className="text-sm text-gray-500 mr-2">
                      {(file.size / 1024).toFixed(1)} KB
                    </span>
                    {converting && processingFiles.some(f => f.index === index) ? (
                      <span className="text-xs text-blue-600 mr-2">
                        Procesando...
                      </span>
                    ) : null}
                    <button 
                      onClick={() => removeFile(index)}
                      className="text-red-500 hover:text-red-700"
                      disabled={converting}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      
      {/* Configuración */}
      <div className="mb-6 grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Opciones de formato */}
        <div>
          <label className="block text-sm font-medium mb-2">Formato de salida:</label>
          <select 
            className="w-full p-2 border border-gray-300 rounded-md"
            value={format}
            onChange={(e) => setFormat(e.target.value)}
            disabled={converting}
          >
            <option value="mp3">MP3</option>
            <option value="wav">WAV</option>
          </select>
        </div>
        
        {/* Selección de número de procesadores */}
        <div>
          <div className="flex flex-col">
            <label className="block text-sm font-medium mb-2">
              Procesos paralelos:
            </label>
            <div className="flex items-center">
              <input 
                type="range" 
                min="1" 
                max={Math.min(16, cpuCores * 12)} // Límite superior
                value={maxWorkers}
                onChange={(e) => setMaxWorkers(parseInt(e.target.value))}
                disabled={converting}
                className="w-full mr-2"
              />
              <span className="text-sm font-medium">{maxWorkers}</span>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Tu dispositivo tiene {cpuCores} núcleos CPU. Un valor superior puede mejorar el rendimiento o ralentizarlo dependiendo de tu hardware.
            </p>
          </div>
        </div>
      </div>
      
      {/* Botón de conversión */}
      <button 
        className="w-full bg-blue-600 text-white py-3 px-4 rounded-md hover:bg-blue-700 transition disabled:bg-gray-400"
        onClick={handleConvert}
        disabled={files.length === 0 || converting}
      >
        {converting ? `Convirtiendo (${filesProcessed}/${files.length})...` : 'Convertir todos los archivos'}
      </button>
      
      {/* Barras de progreso y estadísticas */}
      {converting && (
        <div className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-3">
            <div className="bg-blue-50 p-2 rounded-md text-center">
              <p className="text-xs text-gray-600">Archivos procesados</p>
              <p className="text-lg font-semibold text-blue-800">{filesProcessed} / {files.length}</p>
            </div>
            <div className="bg-blue-50 p-2 rounded-md text-center">
              <p className="text-xs text-gray-600">Tiempo transcurrido</p>
              <p className="text-lg font-semibold text-blue-800">{Math.floor(elapsedTime / 60)}:{(elapsedTime % 60).toString().padStart(2, '0')}</p>
            </div>
            <div className="bg-blue-50 p-2 rounded-md text-center">
              <p className="text-xs text-gray-600">Tiempo restante est.</p>
              <p className="text-lg font-semibold text-blue-800">{estimateRemainingTime()}</p>
            </div>
          </div>
          
          <p className="text-sm font-medium text-gray-700 mb-1">Progreso actual:</p>
          <div className="w-full bg-gray-200 rounded-full h-2.5 mb-3">
            <div 
              className="bg-blue-600 h-2.5 rounded-full transition-all duration-300 ease-in-out" 
              style={{ width: `${calculateAverageProgress()}%` }}
            ></div>
          </div>
          
          <p className="text-sm font-medium text-gray-700 mb-1">Progreso total:</p>
          <div className="w-full bg-gray-200 rounded-full h-2.5 mb-2">
            <div 
              className="bg-green-600 h-2.5 rounded-full transition-all duration-300 ease-in-out" 
              style={{ width: `${totalProgress}%` }}
            ></div>
          </div>
          
          <div className="flex justify-between text-xs text-gray-500 mb-3">
            <span>Velocidad: {calculateConversionRate()} archivos/seg</span>
            <span>Paralelismo: {processingFiles.length}/{maxWorkers} activos</span>
          </div>
          
          <p className="text-center text-sm text-gray-600 mt-2">{message}</p>
          
          {/* Archivos en procesamiento */}
          {processingFiles.length > 0 && (
            <div className="mt-2">
              <p className="text-xs text-gray-600 text-center mb-1">
                Procesando {processingFiles.length} archivo(s) simultáneamente:
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {processingFiles.map((file, idx) => (
                  <span key={idx} className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded-full">
                    {file.name.length > 20 ? `${file.name.substring(0, 20)}...` : file.name}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      
      {/* Archivos convertidos */}
      {convertedFiles.length > 0 && (
        <div className="mt-6">
          <h2 className="text-lg font-semibold mb-2">Archivos convertidos ({convertedFiles.length}):</h2>
          <div className="space-y-4">
            {convertedFiles.map((file, index) => (
              <div key={index} className="p-4 bg-gray-50 rounded-md">
                <div className="flex justify-between items-center mb-2">
                  <span className="font-medium truncate mr-2">
                    {file.name}
                  </span>
                  <a 
                    href={file.url} 
                    download={file.name}
                    className="bg-green-600 text-white py-1 px-3 rounded-md text-sm hover:bg-green-700 transition"
                  >
                    Descargar
                  </a>
                </div>
                <audio controls className="w-full mt-2">
                  <source src={file.url} type={file.format === 'mp3' ? 'audio/mp3' : 'audio/wav'} />
                  Tu navegador no soporta la reproducción de audio.
                </audio>
              </div>
            ))}
          </div>
          
          {/* Botón para descargar todos los archivos */}
          {convertedFiles.length > 1 && (
            <div className="mt-4 text-center">
              <button 
                className="bg-green-600 text-white py-2 px-6 rounded-md hover:bg-green-700 transition"
                onClick={() => {
                  // Crear un enlace de descarga para cada archivo
                  convertedFiles.forEach(file => {
                    const a = document.createElement('a');
                    a.href = file.url;
                    a.download = file.name;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    
                    // Pequeño retardo para evitar problemas con múltiples descargas
                    setTimeout(() => {}, 100);
                  });
                }}
              >
                Descargar todos los archivos
              </button>
            </div>
          )}
        </div>
      )}
      
      {/* Información */}
      <div className="mt-8 p-4 bg-blue-50 rounded-md text-sm">
        <h3 className="font-semibold mb-2">Notas:</h3>
        <ul className="list-disc pl-5 space-y-1 text-gray-700">
          <li>Esta aplicación procesa los archivos de audio directamente en tu navegador.</li>
          <li>Puedes ajustar el número de procesos paralelos según la capacidad de tu dispositivo.</li>
          <li><strong>Dispositivos potentes:</strong> Aumenta el número para mayor velocidad.</li>
          <li><strong>Dispositivos menos potentes:</strong> Reduce el número para evitar sobrecarga.</li>
          <li>La conversión no depende de tu conexión a internet, solo de la potencia de tu dispositivo.</li>
          <li>Tus archivos no se suben a ningún servidor.</li>
          <li>Los nombres originales de los archivos se mantienen en la conversión.</li>
        </ul>
      </div>
    </div>
  );
};

export default AudioConverter;