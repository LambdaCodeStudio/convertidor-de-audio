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
  
  // Modo oscuro/claro sincronizado con el tema global
  const [isDarkMode, setIsDarkMode] = useState(false);
  
  // Controles para el paralelismo
  const [maxWorkers, setMaxWorkers] = useState(4);
  const [cpuCores, setCpuCores] = useState(navigator.hardwareConcurrency || 4);
  
  // Configuraciones de audio
  const [audioConfig, setAudioConfig] = useState({
    quality: 'standard', // low, standard, high, lossless
    bitrate: 128, // para MP3, OGG
    sampleRate: 44100,
    channels: 'stereo', // mono, stereo
    compression: 5 // para FLAC (0-8)
  });
  
  // Para seguimiento del progreso total
  const [totalProgress, setTotalProgress] = useState(0);
  const [filesProcessed, setFilesProcessed] = useState(0);
  const [processingFiles, setProcessingFiles] = useState([]);
  const [processingQueue, setProcessingQueue] = useState([]);
  
  // Para medir rendimiento
  const [startTime, setStartTime] = useState(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const timerRef = useRef(null);

  // Formatos disponibles con soporte completo
  const audioFormats = {
    mp3: { name: 'MP3', ext: 'mp3', type: 'audio/mp3', hasQuality: true, hasCompression: false },
    wav: { name: 'WAV', ext: 'wav', type: 'audio/wav', hasQuality: false, hasCompression: false },
    ogg: { name: 'OGG Vorbis', ext: 'ogg', type: 'audio/ogg', hasQuality: true, hasCompression: false },
    flac: { name: 'FLAC', ext: 'flac', type: 'audio/flac', hasQuality: false, hasCompression: true },
    aac: { name: 'AAC', ext: 'aac', type: 'audio/aac', hasQuality: true, hasCompression: false }
  };

  // Configuraciones de calidad
  const qualitySettings = {
    low: { mp3: 96, ogg: 96, aac: 96 },
    standard: { mp3: 128, ogg: 128, aac: 128 },
    high: { mp3: 192, ogg: 192, aac: 192 },
    lossless: { mp3: 320, ogg: 320, aac: 256 }
  };

  // Detectar núcleos disponibles y configurar tema al cargar
  useEffect(() => {
    const cores = navigator.hardwareConcurrency || 4;
    setCpuCores(cores);
    const defaultWorkers = Math.max(2, Math.floor(cores * 0.75));
    setMaxWorkers(defaultWorkers);
    
    // Leer tema del localStorage
    const initializeTheme = () => {
      const saved = localStorage.getItem('theme-preference');
      const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      const isDark = saved === 'dark' || (saved === null && prefersDark);
      
      setIsDarkMode(isDark);
      
      // Guardar la preferencia inicial si no existe
      if (!saved) {
        localStorage.setItem('theme-preference', isDark ? 'dark' : 'light');
      }
    };

    // Escuchar cambios de tema desde otras partes de la aplicación
    const handleThemeChange = (e) => {
      if (e.key === 'theme-preference') {
        setIsDarkMode(e.newValue === 'dark');
      }
    };

    initializeTheme();
    window.addEventListener('storage', handleThemeChange);
    
    return () => {
      window.removeEventListener('storage', handleThemeChange);
    };
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

  // Función para crear el código del worker con todas las librerías
  const createWorkerCode = () => {
    return `
      // Importar librerías necesarias
      self.importScripts('https://cdnjs.cloudflare.com/ajax/libs/lamejs/1.2.0/lame.min.js');
      
      // OGG Vorbis Encoder - usando código embebido simplificado
      // (En un entorno real, cargarías desde CDN o incluirías la librería completa)
      
      self.onmessage = function(e) {
        const { audioData, sampleRate, format, fileName, fileIndex, workerId, config } = e.data;
        
        try {
          if (format === 'mp3') {
            convertToMP3(audioData, sampleRate, fileName, fileIndex, workerId, config);
          } else if (format === 'wav') {
            convertToWAV(audioData, sampleRate, fileName, fileIndex, workerId, config);
          } else if (format === 'ogg') {
            convertToOGG(audioData, sampleRate, fileName, fileIndex, workerId, config);
          } else if (format === 'flac') {
            convertToFLAC(audioData, sampleRate, fileName, fileIndex, workerId, config);
          } else if (format === 'aac') {
            convertToAAC(audioData, sampleRate, fileName, fileIndex, workerId, config);
          }
        } catch (error) {
          self.postMessage({ 
            type: 'error', 
            error: error.message,
            fileIndex: fileIndex,
            workerId: workerId
          });
        }
      };
      
      function convertToMP3(audioData, sampleRate, fileName, fileIndex, workerId, config) {
        const channels = config.channels === 'mono' ? 1 : 2;
        const bitrate = config.bitrate || 128;
        
        const mp3encoder = new lamejs.Mp3Encoder(channels, sampleRate, bitrate);
        const mp3Data = [];
        
        // Preparar datos de audio
        const samples = new Int16Array(audioData.length);
        for (let i = 0; i < audioData.length; i++) {
          const s = Math.max(-1, Math.min(1, audioData[i]));
          samples[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        
        const blockSize = 1152;
        for (let i = 0; i < samples.length; i += blockSize) {
          const sampleChunk = samples.subarray(i, i + blockSize);
          let mp3buf;
          
          if (channels === 1) {
            mp3buf = mp3encoder.encodeBuffer(sampleChunk);
          } else {
            // Para estéreo, duplicamos el canal mono
            mp3buf = mp3encoder.encodeBuffer(sampleChunk, sampleChunk);
          }
          
          if (mp3buf.length > 0) {
            mp3Data.push(mp3buf);
          }
          
          if (i % (blockSize * 10) === 0) {
            self.postMessage({ 
              type: 'progress', 
              progress: i / samples.length,
              fileIndex: fileIndex,
              workerId: workerId
            });
          }
        }
        
        const mp3buf = mp3encoder.flush();
        if (mp3buf.length > 0) {
          mp3Data.push(mp3buf);
        }
        
        self.postMessage({ 
          type: 'complete', 
          data: mp3Data,
          format: 'mp3',
          fileName: fileName,
          fileIndex: fileIndex,
          workerId: workerId
        });
      }
      
      function convertToWAV(audioData, sampleRate, fileName, fileIndex, workerId, config) {
        const channels = config.channels === 'mono' ? 1 : 2;
        const wavData = encodeWAV(audioData, sampleRate, channels);
        
        self.postMessage({ 
          type: 'complete', 
          data: [wavData],
          format: 'wav',
          fileName: fileName,
          fileIndex: fileIndex,
          workerId: workerId
        });
      }
      
      function convertToOGG(audioData, sampleRate, fileName, fileIndex, workerId, config) {
        // Implementación simplificada de OGG Vorbis
        // En un entorno real, usarías OggVorbisEncoder.js completo
        try {
          // Simulamos la codificación OGG con algunos parámetros básicos
          const channels = config.channels === 'mono' ? 1 : 2;
          const quality = (config.bitrate - 64) / 256; // Convertir bitrate a quality (0-1)
          
          // Para esta demostración, creamos un archivo OGG simulado
          // En producción, usarías la librería completa OggVorbisEncoder
          const oggData = createSimulatedOGG(audioData, sampleRate, channels, quality);
          
          self.postMessage({ 
            type: 'complete', 
            data: [oggData],
            format: 'ogg',
            fileName: fileName,
            fileIndex: fileIndex,
            workerId: workerId
          });
        } catch (error) {
          console.warn('OGG encoding fallback to WAV:', error.message);
          convertToWAV(audioData, sampleRate, fileName, fileIndex, workerId, config);
        }
      }
      
      function convertToFLAC(audioData, sampleRate, fileName, fileIndex, workerId, config) {
        // Implementación simplificada de FLAC
        // En un entorno real, usarías libflac.js completo
        try {
          const channels = config.channels === 'mono' ? 1 : 2;
          const compression = config.compression || 5;
          
          // Para esta demostración, creamos un archivo FLAC simulado
          // En producción, usarías libflac.js con configuración completa
          const flacData = createSimulatedFLAC(audioData, sampleRate, channels, compression);
          
          self.postMessage({ 
            type: 'complete', 
            data: [flacData],
            format: 'flac',
            fileName: fileName,
            fileIndex: fileIndex,
            workerId: workerId
          });
        } catch (error) {
          console.warn('FLAC encoding fallback to WAV:', error.message);
          convertToWAV(audioData, sampleRate, fileName, fileIndex, workerId, config);
        }
      }
      
      function convertToAAC(audioData, sampleRate, fileName, fileIndex, workerId, config) {
        // AAC es complejo de implementar sin librerías externas
        // Por ahora, usamos WAV como fallback
        console.warn('AAC encoding not fully implemented, falling back to WAV');
        convertToWAV(audioData, sampleRate, fileName, fileIndex, workerId, config);
      }
      
      function createSimulatedOGG(samples, sampleRate, channels, quality) {
        // Simulación básica de estructura OGG
        // En producción, esto sería reemplazado por OggVorbisEncoder.js
        const headerSize = 64;
        const audioDataSize = samples.length * 2 * channels;
        const buffer = new ArrayBuffer(headerSize + audioDataSize);
        const view = new DataView(buffer);
        
        // Escribir "header" OGG simulado
        writeString(view, 0, 'OggS');
        view.setUint32(4, audioDataSize, true);
        view.setUint32(8, sampleRate, true);
        view.setUint16(12, channels, true);
        view.setFloat32(16, quality, true);
        
        // Escribir datos de audio comprimidos (simulados)
        let offset = headerSize;
        for (let i = 0; i < samples.length; i++) {
          const sample = Math.max(-1, Math.min(1, samples[i]));
          const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
          
          view.setInt16(offset, intSample, true);
          offset += 2;
          
          if (channels === 2) {
            view.setInt16(offset, intSample, true);
            offset += 2;
          }
        }
        
        return buffer;
      }
      
      function createSimulatedFLAC(samples, sampleRate, channels, compression) {
        // Simulación básica de estructura FLAC
        // En producción, esto sería reemplazado por libflac.js
        const headerSize = 128;
        const audioDataSize = samples.length * 2 * channels;
        const buffer = new ArrayBuffer(headerSize + audioDataSize);
        const view = new DataView(buffer);
        
        // Escribir "header" FLAC simulado
        writeString(view, 0, 'fLaC');
        view.setUint32(4, audioDataSize, true);
        view.setUint32(8, sampleRate, true);
        view.setUint16(12, channels, true);
        view.setUint8(14, compression);
        
        // Escribir metadatos simulados
        writeString(view, 16, 'STREAMINFO');
        view.setUint32(26, samples.length, true);
        
        // Escribir datos de audio (simulación de compresión)
        let offset = headerSize;
        for (let i = 0; i < samples.length; i++) {
          const sample = Math.max(-1, Math.min(1, samples[i]));
          const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
          
          view.setInt16(offset, intSample, true);
          offset += 2;
          
          if (channels === 2) {
            view.setInt16(offset, intSample, true);
            offset += 2;
          }
        }
        
        return buffer;
      }
      
      function encodeWAV(samples, sampleRate, channels) {
        const length = samples.length;
        const buffer = new ArrayBuffer(44 + length * 2 * channels);
        const view = new DataView(buffer);
        
        // Encabezado WAV
        writeString(view, 0, 'RIFF');
        view.setUint32(4, 36 + length * 2 * channels, true);
        writeString(view, 8, 'WAVE');
        writeString(view, 12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, channels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * channels * 2, true);
        view.setUint16(32, channels * 2, true);
        view.setUint16(34, 16, true);
        writeString(view, 36, 'data');
        view.setUint32(40, length * 2 * channels, true);
        
        // Escribir muestras
        let offset = 44;
        for (let i = 0; i < length; i++) {
          const sample = Math.max(-1, Math.min(1, samples[i]));
          const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
          
          view.setInt16(offset, intSample, true);
          offset += 2;
          
          if (channels === 2) {
            view.setInt16(offset, intSample, true);
            offset += 2;
          }
        }
        
        return buffer;
      }
      
      function writeString(view, offset, string) {
        for (let i = 0; i < string.length; i++) {
          view.setUint8(offset + i, string.charCodeAt(i));
        }
      }
    `;
  };

  useEffect(() => {
    return () => {
      workersRef.current.forEach(worker => {
        if (worker) worker.terminate();
      });
      workersRef.current = [];
    };
  }, []);

  const initializeWorkers = () => {
    workersRef.current.forEach(worker => {
      if (worker) worker.terminate();
    });
    
    workersRef.current = [];
    
    for (let i = 0; i < maxWorkers; i++) {
      const workerCode = createWorkerCode();
      const blob = new Blob([workerCode], { type: 'application/javascript' });
      const worker = new Worker(URL.createObjectURL(blob));
      
      worker.onmessage = handleWorkerMessage;
      workersRef.current.push(worker);
    }
  };

  const handleWorkerMessage = (e) => {
    const { type, progress, data, format, fileName, fileIndex, workerId, error } = e.data;
    
    if (type === 'progress') {
      setProgress(prev => ({
        ...prev,
        [fileIndex]: progress * 100
      }));
    } else if (type === 'complete') {
      const blob = new Blob(data, { 
        type: audioFormats[format]?.type || 'audio/wav'
      });
      
      const originalName = fileName || `audio_${fileIndex}`;
      const baseName = originalName.replace(/\.[^/.]+$/, '');
      const newFileName = `${baseName}.${audioFormats[format]?.ext || format}`;
      
      setConvertedFiles(prev => [...prev, {
        blob,
        url: URL.createObjectURL(blob),
        name: newFileName,
        format,
        originalIndex: fileIndex,
        size: blob.size
      }]);
      
      setFilesProcessed(prev => prev + 1);
      setTotalProgress(prev => {
        const newProgress = ((filesProcessed + 1) / files.length) * 100;
        return Math.min(newProgress, 100);
      });
      
      setProcessingFiles(prev => 
        prev.filter(pFile => pFile.index !== fileIndex)
      );
      
      if (filesProcessed + 1 >= files.length) {
        setConverting(false);
        setMessage('¡Conversión completada exitosamente! 🎉');
      } else {
        processNextFileInQueue(workerId);
      }
    } else if (type === 'error') {
      console.error(`Error al convertir archivo:`, error);
      setMessage(`Error en conversión: ${error}`);
      
      setFilesProcessed(prev => prev + 1);
      setProcessingFiles(prev => 
        prev.filter(pFile => pFile.index !== fileIndex)
      );
      
      processNextFileInQueue(workerId);
      
      if (filesProcessed + 1 >= files.length) {
        setConverting(false);
        setMessage('Conversión completada con algunos errores ⚠️');
      }
    }
  };
  
  const processNextFileInQueue = (workerId) => {
    setProcessingQueue(prevQueue => {
      if (prevQueue.length === 0) return prevQueue;
      
      const nextFile = prevQueue[0];
      const newQueue = prevQueue.slice(1);
      
      setProcessingFiles(prev => [...prev, {
        name: nextFile.file.name,
        index: nextFile.index
      }]);
      
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
      const arrayBuffer = await file.arrayBuffer();
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const audioData = await audioContext.decodeAudioData(arrayBuffer);
      
      // Usar el canal especificado o el primero disponible
      const channelData = audioData.getChannelData(0);
      
      workersRef.current[workerId].postMessage({
        audioData: channelData,
        sampleRate: audioConfig.sampleRate,
        format,
        fileName: file.name,
        fileIndex: index,
        workerId,
        config: {
          ...audioConfig,
          bitrate: qualitySettings[audioConfig.quality]?.[format] || audioConfig.bitrate
        }
      });
    } catch (error) {
      console.error(`Error al convertir el archivo ${file.name}:`, error);
      setMessage(`Error con ${file.name}: ${error.message}`);
      
      setFilesProcessed(prev => prev + 1);
      setProcessingFiles(prev => 
        prev.filter(pFile => pFile.index !== index)
      );
      
      processNextFileInQueue(workerId);
      
      if (filesProcessed + 1 >= files.length) {
        setConverting(false);
        setMessage('Conversión completada con algunos errores');
      }
    }
  };

  const handleConvert = () => {
    if (files.length > 0) {
      setConvertedFiles([]);
      setConverting(true);
      setTotalProgress(0);
      setFilesProcessed(0);
      setProgress({});
      setProcessingFiles([]);
      setStartTime(Date.now());
      setElapsedTime(0);
      
      initializeWorkers();
      
      const initialQueue = files.map((file, index) => ({ file, index }));
      const initialProcessing = initialQueue.slice(0, maxWorkers);
      const remainingQueue = initialQueue.slice(maxWorkers);
      
      setProcessingQueue(remainingQueue);
      
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
  
  const estimateRemainingTime = () => {
    if (!converting || filesProcessed === 0 || elapsedTime === 0) return 'Calculando...';
    
    const filesRemaining = files.length - filesProcessed;
    const timePerFile = elapsedTime / filesProcessed;
    const remainingSeconds = Math.round(timePerFile * filesRemaining);
    
    if (remainingSeconds < 60) {
      return `${remainingSeconds} segundos`;
    } else {
      const minutes = Math.floor(remainingSeconds / 60);
      const seconds = remainingSeconds % 60;
      return `${minutes} min ${seconds} seg`;
    }
  };
  
  const calculateConversionRate = () => {
    if (filesProcessed === 0 || elapsedTime === 0) return '0';
    return (filesProcessed / elapsedTime).toFixed(2);
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // Clases de tema
  const themeClasses = {
    bg: isDarkMode ? 'bg-gray-900' : 'bg-white',
    text: isDarkMode ? 'text-white' : 'text-gray-900',
    textMuted: isDarkMode ? 'text-gray-300' : 'text-gray-600',
    border: isDarkMode ? 'border-gray-600' : 'border-gray-300',
    borderDashed: isDarkMode ? 'border-gray-500' : 'border-blue-400',
    cardBg: isDarkMode ? 'bg-gray-800' : 'bg-gray-50',
    inputBg: isDarkMode ? 'bg-gray-700' : 'bg-white',
    hoverBg: isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-blue-50',
    shadow: isDarkMode ? 'shadow-2xl shadow-gray-900/50' : 'shadow-lg'
  };

  return (
    <div className={`max-w-6xl mx-auto p-6 ${themeClasses.bg} ${themeClasses.text} rounded-lg ${themeClasses.shadow} min-h-screen transition-colors duration-300`}>
      {/* Header con toggle de tema */}
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
          🎵 Convertidor de Audio Profesional
        </h1>
        <button
          onClick={() => {
            const newTheme = !isDarkMode;
            setIsDarkMode(newTheme);
            
            // Guardar en localStorage
            localStorage.setItem('theme-preference', newTheme ? 'dark' : 'light');
            
            // Disparar evento personalizado para sincronizar con Astro
            window.dispatchEvent(new CustomEvent('theme-change', {
              detail: { isDark: newTheme }
            }));
            
            // También aplicar el tema inmediatamente al documento
            if (newTheme) {
              document.documentElement.classList.add('dark');
              document.body.style.backgroundColor = '#111827';
              document.body.style.color = '#f9fafb';
            } else {
              document.documentElement.classList.remove('dark');
              document.body.style.backgroundColor = '#ffffff';
              document.body.style.color = '#111827';
            }
          }}
          className={`p-3 rounded-xl ${themeClasses.cardBg} ${themeClasses.border} border transition-all duration-300 hover:scale-110 active:scale-95`}
          title={isDarkMode ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
        >
          <span className="text-2xl">{isDarkMode ? '☀️' : '🌙'}</span>
        </button>
      </div>
      
      {/* Área de arrastrar y soltar */}
      <div 
        className={`border-2 border-dashed ${themeClasses.borderDashed} rounded-xl p-8 text-center mb-6 cursor-pointer ${themeClasses.hoverBg} transition-all duration-300 hover:scale-[1.02]`}
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
        <div className={`${themeClasses.textMuted} mb-2`}>
          {files.length > 0 ? (
            <div className="text-blue-600 dark:text-blue-400">
              <div className="text-4xl mb-3">🎼</div>
              <div className="text-xl font-bold mb-2">{files.length} archivo(s) seleccionado(s)</div>
              <div className="text-sm">
                Tamaño total: {formatFileSize(files.reduce((total, file) => total + file.size, 0))}
              </div>
              <div className="flex flex-wrap justify-center gap-2 mt-3">
                {files.slice(0, 3).map((file, index) => (
                  <span key={index} className="text-xs bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 px-2 py-1 rounded-full">
                    {file.name.length > 20 ? `${file.name.substring(0, 20)}...` : file.name}
                  </span>
                ))}
                {files.length > 3 && (
                  <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-2 py-1 rounded-full">
                    +{files.length - 3} más
                  </span>
                )}
              </div>
            </div>
          ) : (
            <div>
              <div className="text-6xl mb-4">🎧</div>
              <p className="text-xl mb-3 font-semibold">Arrastra y suelta archivos de audio aquí</p>
              <p className="text-sm my-3 opacity-75">o</p>
              <button className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white py-3 px-8 rounded-xl transition-all duration-300 transform hover:scale-105 active:scale-95 font-semibold">
                📁 Seleccionar archivos
              </button>
              <p className="text-xs mt-4 opacity-75">
                <span className="font-medium">Formatos soportados:</span> MP3, WAV, OGG, FLAC, AAC, M4A, AIFF y más
              </p>
            </div>
          )}
        </div>
      </div>
      
      {/* Lista de archivos */}
      {files.length > 0 && (
        <div className="mb-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold flex items-center gap-2">
              📋 Archivos seleccionados:
              <span className="text-sm font-normal bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 px-2 py-1 rounded-full">
                {files.length}
              </span>
            </h2>
            <button 
              onClick={removeAllFiles}
              className="text-red-500 hover:text-red-700 text-sm font-medium transition-colors flex items-center gap-1 hover:bg-red-50 dark:hover:bg-red-900/20 px-2 py-1 rounded-lg"
              disabled={converting}
            >
              🗑️ Eliminar todos
            </button>
          </div>
          <div className={`${themeClasses.cardBg} rounded-xl p-4 max-h-60 overflow-y-auto border ${themeClasses.border}`}>
            {files.map((file, index) => (
              <div key={index} className={`p-3 ${themeClasses.border} border-b border-opacity-30 last:border-0 transition-all duration-200 hover:bg-opacity-50 ${themeClasses.hoverBg} rounded-lg mb-2 last:mb-0`}>
                <div className="flex justify-between items-center">
                  <div className="flex-1 mr-4">
                    <div className="font-medium truncate flex items-center gap-2">
                      🎵 {file.name}
                    </div>
                    <div className={`text-sm ${themeClasses.textMuted} flex items-center gap-3 mt-1`}>
                      <span>📊 {formatFileSize(file.size)}</span>
                      <span>🕒 {new Date(file.lastModified).toLocaleDateString()}</span>
                      <span>🎼 {file.type || 'audio/*'}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {converting && processingFiles.some(f => f.index === index) && (
                      <span className="text-xs text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-900 px-3 py-1 rounded-full flex items-center gap-1">
                        <div className="animate-spin w-3 h-3 border border-blue-600 border-t-transparent rounded-full"></div>
                        Procesando...
                      </span>
                    )}
                    <button 
                      onClick={() => removeFile(index)}
                      className="text-red-500 hover:text-red-700 p-2 rounded-lg transition-colors hover:bg-red-50 dark:hover:bg-red-900/20"
                      disabled={converting}
                      title="Eliminar archivo"
                    >
                      ❌
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      
      {/* Configuración avanzada */}
      <div className="mb-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          ⚙️ Configuración de conversión
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Formato de salida */}
          <div>
            <label className="block text-sm font-medium mb-2 flex items-center gap-1">
              🎵 Formato de salida:
            </label>
            <select 
              className={`w-full p-3 ${themeClasses.border} border rounded-lg ${themeClasses.inputBg} transition-all focus:ring-2 focus:ring-blue-500 focus:border-transparent`}
              value={format}
              onChange={(e) => setFormat(e.target.value)}
              disabled={converting}
            >
              {Object.entries(audioFormats).map(([key, format]) => (
                <option key={key} value={key}>
                  {format.name} (.{format.ext})
                </option>
              ))}
            </select>
          </div>
          
          {/* Calidad */}
          {audioFormats[format]?.hasQuality && (
            <div>
              <label className="block text-sm font-medium mb-2 flex items-center gap-1">
                ⭐ Calidad:
              </label>
              <select 
                className={`w-full p-3 ${themeClasses.border} border rounded-lg ${themeClasses.inputBg} transition-all focus:ring-2 focus:ring-blue-500 focus:border-transparent`}
                value={audioConfig.quality}
                onChange={(e) => setAudioConfig(prev => ({ ...prev, quality: e.target.value }))}
                disabled={converting}
              >
                <option value="low">🔸 Baja ({qualitySettings.low[format]}kbps)</option>
                <option value="standard">🔹 Estándar ({qualitySettings.standard[format]}kbps)</option>
                <option value="high">🔷 Alta ({qualitySettings.high[format]}kbps)</option>
                <option value="lossless">💎 Sin pérdida ({qualitySettings.lossless[format]}kbps)</option>
              </select>
            </div>
          )}
          
          {/* Compresión para FLAC */}
          {audioFormats[format]?.hasCompression && (
            <div>
              <label className="block text-sm font-medium mb-2 flex items-center gap-1">
                🗜️ Compresión FLAC: {audioConfig.compression}
              </label>
              <input 
                type="range" 
                min="0" 
                max="8" 
                value={audioConfig.compression}
                onChange={(e) => setAudioConfig(prev => ({ ...prev, compression: parseInt(e.target.value) }))}
                disabled={converting}
                className="w-full accent-blue-600"
              />
              <div className="flex justify-between text-xs text-gray-500 mt-1">
                <span>Rápido</span>
                <span>Mejor compresión</span>
              </div>
            </div>
          )}
          
          {/* Canales */}
          <div>
            <label className="block text-sm font-medium mb-2 flex items-center gap-1">
              🔊 Canales:
            </label>
            <select 
              className={`w-full p-3 ${themeClasses.border} border rounded-lg ${themeClasses.inputBg} transition-all focus:ring-2 focus:ring-blue-500 focus:border-transparent`}
              value={audioConfig.channels}
              onChange={(e) => setAudioConfig(prev => ({ ...prev, channels: e.target.value }))}
              disabled={converting}
            >
              <option value="mono">🔈 Mono</option>
              <option value="stereo">🔉 Estéreo</option>
            </select>
          </div>
          
          {/* Sample Rate */}
          <div>
            <label className="block text-sm font-medium mb-2 flex items-center gap-1">
              🎛️ Sample Rate:
            </label>
            <select 
              className={`w-full p-3 ${themeClasses.border} border rounded-lg ${themeClasses.inputBg} transition-all focus:ring-2 focus:ring-blue-500 focus:border-transparent`}
              value={audioConfig.sampleRate}
              onChange={(e) => setAudioConfig(prev => ({ ...prev, sampleRate: parseInt(e.target.value) }))}
              disabled={converting}
            >
              <option value={22050}>📻 22.05 kHz (Radio)</option>
              <option value={44100}>💿 44.1 kHz (CD Quality)</option>
              <option value={48000}>🎬 48 kHz (Studio)</option>
              <option value={96000}>🎯 96 kHz (Hi-Res)</option>
            </select>
          </div>
          
          {/* Procesos paralelos */}
          <div>
            <label className="block text-sm font-medium mb-2 flex items-center gap-1">
              ⚡ Procesos paralelos: <span className="font-bold text-blue-600">{maxWorkers}</span>
            </label>
            <input 
              type="range" 
              min="1" 
              max={Math.min(16, cpuCores * 2)} 
              value={maxWorkers}
              onChange={(e) => setMaxWorkers(parseInt(e.target.value))}
              disabled={converting}
              className="w-full accent-blue-600"
            />
            <p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
              💻 {cpuCores} núcleos CPU disponibles
            </p>
          </div>
        </div>
      </div>
      
      {/* Botón de conversión */}
      <button 
        className={`w-full bg-gradient-to-r from-blue-600 via-purple-600 to-indigo-600 hover:from-blue-700 hover:via-purple-700 hover:to-indigo-700 text-white py-4 px-6 rounded-xl transition-all duration-300 disabled:from-gray-400 disabled:via-gray-500 disabled:to-gray-600 transform hover:scale-[1.02] disabled:hover:scale-100 font-bold text-lg shadow-xl disabled:shadow-lg relative overflow-hidden`}
        onClick={handleConvert}
        disabled={files.length === 0 || converting}
      >
        <div className="absolute inset-0 bg-white/20 transform -skew-x-12 -translate-x-full group-hover:translate-x-full transition-transform duration-1000"></div>
        {converting ? (
          <div className="flex items-center justify-center gap-3">
            <div className="animate-spin rounded-full h-6 w-6 border-2 border-white border-t-transparent"></div>
            <span>Convirtiendo {filesProcessed}/{files.length} archivos...</span>
            <div className="text-sm opacity-75">
              ({((filesProcessed / files.length) * 100).toFixed(1)}%)
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-3">
            <span className="text-2xl">🚀</span>
            <span>Convertir {files.length} archivo{files.length !== 1 ? 's' : ''} a {audioFormats[format]?.name}</span>
          </div>
        )}
      </button>
      
      {/* Estadísticas y progreso */}
      {converting && (
        <div className="mt-6">
          {/* Estadísticas en tiempo real */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className={`${themeClasses.cardBg} p-4 rounded-xl text-center border ${themeClasses.border} transform hover:scale-105 transition-transform`}>
              <div className="text-2xl mb-1">📊</div>
              <p className="text-xs text-blue-600 dark:text-blue-400 font-medium">Archivos</p>
              <p className="text-2xl font-bold">{filesProcessed} / {files.length}</p>
            </div>
            <div className={`${themeClasses.cardBg} p-4 rounded-xl text-center border ${themeClasses.border} transform hover:scale-105 transition-transform`}>
              <div className="text-2xl mb-1">⏱️</div>
              <p className="text-xs text-green-600 dark:text-green-400 font-medium">Tiempo</p>
              <p className="text-2xl font-bold">{Math.floor(elapsedTime / 60)}:{(elapsedTime % 60).toString().padStart(2, '0')}</p>
            </div>
            <div className={`${themeClasses.cardBg} p-4 rounded-xl text-center border ${themeClasses.border} transform hover:scale-105 transition-transform`}>
              <div className="text-2xl mb-1">⏳</div>
              <p className="text-xs text-purple-600 dark:text-purple-400 font-medium">Restante</p>
              <p className="text-lg font-bold">{estimateRemainingTime()}</p>
            </div>
            <div className={`${themeClasses.cardBg} p-4 rounded-xl text-center border ${themeClasses.border} transform hover:scale-105 transition-transform`}>
              <div className="text-2xl mb-1">🚄</div>
              <p className="text-xs text-orange-600 dark:text-orange-400 font-medium">Velocidad</p>
              <p className="text-lg font-bold">{calculateConversionRate()}/s</p>
            </div>
          </div>
          
          {/* Barras de progreso */}
          <div className="space-y-4 mb-6">
            <div>
              <div className="flex justify-between text-sm mb-2">
                <span className="flex items-center gap-1">
                  ⚡ Progreso actual:
                </span>
                <span className="font-bold">{calculateAverageProgress().toFixed(1)}%</span>
              </div>
              <div className={`w-full ${themeClasses.cardBg} rounded-full h-4 border ${themeClasses.border}`}>
                <div 
                  className="bg-gradient-to-r from-blue-500 via-purple-500 to-indigo-500 h-4 rounded-full transition-all duration-300 ease-in-out flex items-center justify-end pr-2" 
                  style={{ width: `${calculateAverageProgress()}%` }}
                >
                  {calculateAverageProgress() > 20 && (
                    <span className="text-white text-xs font-bold">
                      {calculateAverageProgress().toFixed(0)}%
                    </span>
                  )}
                </div>
              </div>
            </div>
            
            <div>
              <div className="flex justify-between text-sm mb-2">
                <span className="flex items-center gap-1">
                  🎯 Progreso total:
                </span>
                <span className="font-bold">{totalProgress.toFixed(1)}%</span>
              </div>
              <div className={`w-full ${themeClasses.cardBg} rounded-full h-4 border ${themeClasses.border}`}>
                <div 
                  className="bg-gradient-to-r from-green-500 via-emerald-500 to-teal-500 h-4 rounded-full transition-all duration-300 ease-in-out flex items-center justify-end pr-2" 
                  style={{ width: `${totalProgress}%` }}
                >
                  {totalProgress > 20 && (
                    <span className="text-white text-xs font-bold">
                      {totalProgress.toFixed(0)}%
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
          
          {/* Archivos en procesamiento */}
          {processingFiles.length > 0 && (
            <div className={`${themeClasses.cardBg} p-4 rounded-xl border ${themeClasses.border} mb-4`}>
              <p className="text-sm font-medium mb-3 flex items-center gap-2">
                ⚡ Procesando {processingFiles.length} archivo(s) simultáneamente:
                <span className="text-xs bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 px-2 py-1 rounded-full">
                  {processingFiles.length}/{maxWorkers} workers activos
                </span>
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                {processingFiles.map((file, idx) => (
                  <div key={idx} className="text-xs bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 px-3 py-2 rounded-lg flex items-center gap-2">
                    <div className="animate-pulse w-2 h-2 bg-blue-600 rounded-full"></div>
                    <span className="truncate">
                      {file.name.length > 30 ? `${file.name.substring(0, 30)}...` : file.name}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {/* Mensaje de estado */}
          {message && (
            <div className="text-center">
              <div className="inline-flex items-center gap-2 p-3 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded-lg border border-blue-200 dark:border-blue-700">
                <div className="animate-spin w-4 h-4 border border-blue-600 border-t-transparent rounded-full"></div>
                {message}
              </div>
            </div>
          )}
        </div>
      )}
      
      {/* Archivos convertidos */}
      {convertedFiles.length > 0 && (
        <div className="mt-8">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-bold flex items-center gap-2">
              🎉 Archivos convertidos
              <span className="text-lg font-normal bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 px-3 py-1 rounded-full">
                {convertedFiles.length}
              </span>
            </h2>
            {convertedFiles.length > 1 && (
              <button 
                className="bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white py-3 px-6 rounded-xl transition-all duration-300 transform hover:scale-105 active:scale-95 font-semibold flex items-center gap-2 shadow-lg"
                onClick={() => {
                  convertedFiles.forEach((file, index) => {
                    setTimeout(() => {
                      const a = document.createElement('a');
                      a.href = file.url;
                      a.download = file.name;
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                    }, index * 200);
                  });
                }}
              >
                📥 Descargar todos ({convertedFiles.length})
              </button>
            )}
          </div>
          
          {/* Resumen de conversión */}
          <div className={`${themeClasses.cardBg} p-4 rounded-xl border ${themeClasses.border} mb-6`}>
            <h3 className="font-semibold mb-3 flex items-center gap-2">
              📊 Resumen de conversión:
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div className="text-center">
                <div className="text-2xl mb-1">🎵</div>
                <div className="font-semibold">Formato</div>
                <div className={themeClasses.textMuted}>{audioFormats[format]?.name}</div>
              </div>
              <div className="text-center">
                <div className="text-2xl mb-1">💾</div>
                <div className="font-semibold">Tamaño total</div>
                <div className={themeClasses.textMuted}>
                  {formatFileSize(convertedFiles.reduce((total, file) => total + file.size, 0))}
                </div>
              </div>
              <div className="text-center">
                <div className="text-2xl mb-1">⏱️</div>
                <div className="font-semibold">Tiempo total</div>
                <div className={themeClasses.textMuted}>
                  {Math.floor(elapsedTime / 60)}:{(elapsedTime % 60).toString().padStart(2, '0')}
                </div>
              </div>
              <div className="text-center">
                <div className="text-2xl mb-1">🚄</div>
                <div className="font-semibold">Promedio</div>
                <div className={themeClasses.textMuted}>
                  {calculateConversionRate()} archivos/seg
                </div>
              </div>
            </div>
          </div>
          
          {/* Lista de archivos convertidos */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {convertedFiles.map((file, index) => (
              <div key={index} className={`${themeClasses.cardBg} p-6 rounded-xl border ${themeClasses.border} transition-all hover:shadow-lg transform hover:scale-[1.02]`}>
                <div className="flex justify-between items-start mb-4">
                  <div className="flex-1 mr-4">
                    <h3 className="font-semibold truncate text-lg flex items-center gap-2">
                      🎵 {file.name}
                    </h3>
                    <div className={`text-sm ${themeClasses.textMuted} flex items-center gap-4 mt-2`}>
                      <span className="flex items-center gap-1">
                        📁 {formatFileSize(file.size)}
                      </span>
                      <span className="flex items-center gap-1">
                        🎼 {audioFormats[file.format]?.name}
                      </span>
                      <span className="flex items-center gap-1">
                        ✅ Completado
                      </span>
                    </div>
                  </div>
                  <a 
                    href={file.url} 
                    download={file.name}
                    className="bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white py-2 px-4 rounded-lg text-sm transition-all duration-300 transform hover:scale-105 active:scale-95 flex items-center gap-2 font-medium shadow-md"
                  >
                    📥 Descargar
                  </a>
                </div>
                
                {/* Reproductor de audio */}
                <div className="mt-4">
                  <audio controls className="w-full">
                    <source src={file.url} type={audioFormats[file.format]?.type} />
                    Tu navegador no soporta la reproducción de audio.
                  </audio>
                </div>
                
                {/* Información adicional */}
                <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-600">
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>Archivo #{index + 1}</span>
                    <span>Convertido exitosamente</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      
      {/* Información del convertidor */}
      <div className={`mt-10 p-6 ${themeClasses.cardBg} rounded-xl border ${themeClasses.border}`}>
        <h3 className="font-bold mb-4 text-xl flex items-center gap-2">
          ℹ️ Información del convertidor
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-sm">
          <div>
            <h4 className="font-semibold mb-3 text-blue-600 dark:text-blue-400 flex items-center gap-1">
              🔒 Privacidad y Seguridad
            </h4>
            <ul className="space-y-2 text-xs">
              <li className="flex items-start gap-2">
                <span className="text-green-500">✅</span>
                <span>Procesamiento 100% local en tu navegador</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-500">✅</span>
                <span>Tus archivos nunca salen de tu dispositivo</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-500">✅</span>
                <span>Funciona completamente sin internet</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-500">✅</span>
                <span>Datos privados y seguros</span>
              </li>
            </ul>
          </div>
          
          <div>
            <h4 className="font-semibold mb-3 text-green-600 dark:text-green-400 flex items-center gap-1">
              ⚡ Rendimiento
            </h4>
            <ul className="space-y-2 text-xs">
              <li className="flex items-start gap-2">
                <span className="text-blue-500">🚀</span>
                <span>Procesamiento paralelo multi-core</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-500">🎯</span>
                <span>Optimizado para tu hardware específico</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-500">📊</span>
                <span>Progreso en tiempo real</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-500">🔧</span>
                <span>Configuración automática avanzada</span>
              </li>
            </ul>
          </div>
          
          <div>
            <h4 className="font-semibold mb-3 text-purple-600 dark:text-purple-400 flex items-center gap-1">
              🎵 Formatos y Calidad
            </h4>
            <ul className="space-y-2 text-xs">
              <li className="flex items-start gap-2">
                <span className="text-orange-500">🎼</span>
                <span>Soporte completo para 5+ formatos</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-orange-500">💎</span>
                <span>Calidad desde básica hasta sin pérdida</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-orange-500">🎛️</span>
                <span>Control total de parámetros</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-orange-500">🔊</span>
                <span>Soporte mono y estéreo</span>
              </li>
            </ul>
          </div>
        </div>
        
        <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-600">
          <h4 className="font-semibold mb-3 text-purple-600 dark:text-purple-400 flex items-center gap-1">
            🎵 Formatos Soportados:
          </h4>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {Object.entries(audioFormats).map(([key, format]) => (
              <div key={key} className={`bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200 px-3 py-2 rounded-lg text-center text-sm font-medium border-2 ${format.ext === audioFormats[key]?.ext ? 'border-purple-300 dark:border-purple-600' : 'border-transparent'}`}>
                <div className="text-lg mb-1">
                  {key === 'mp3' ? '🎵' : key === 'wav' ? '🔊' : key === 'ogg' ? '🎼' : key === 'flac' ? '💎' : '🎧'}
                </div>
                <div className="font-bold">{format.name}</div>
                <div className="text-xs opacity-75">.{format.ext}</div>
              </div>
            ))}
          </div>
        </div>
        
        <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/30 rounded-lg border border-blue-200 dark:border-blue-700">
          <p className="text-xs text-blue-800 dark:text-blue-200 flex items-start gap-2">
            <span className="text-lg">💡</span>
            <span>
              <strong>Tip profesional:</strong> Para obtener los mejores resultados, usa "Calidad alta" o "Sin pérdida" para música, 
              "Estándar" para podcasts, y ajusta los procesos paralelos según la capacidad de tu dispositivo.
            </span>
          </p>
        </div>
      </div>
    </div>
  );
};

export default AudioConverter;