const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const mysql = require('mysql2');
const bcrypt = require('bcryptjs');

const fs = require('fs');
const $rdf = require('rdflib');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306
});

db.connect((err) => {
  if (err) {
    console.error('❌ Error de conexión:', err.message);
  } else {
    console.log('✅ Conectado a la base de datos Clever Cloud');
  }
});
// Ruta de prueba
app.get('/', (req, res) => {
    res.send('Backend funcionando');
});

app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});

// 3. Función auxiliar: generarTripletasUsuario
function generarTripletasUsuario(idusuario, callback) {
    const store = $rdf.graph();
    const FOAF = $rdf.Namespace('http://xmlns.com/foaf/0.1/');
    const EX = $rdf.Namespace('http://example.org/ontology#');

    const dir = path.join(__dirname, 'ontologia', 'each_user');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const ttlPath = path.join(dir, `usuario_${idusuario}.ttl`);
    const rdfPath = path.join(dir, `usuario_${idusuario}.rdf`);

    // 1. Consultar usuario
    const queryUsuario = `SELECT * FROM usuario WHERE id = ?`;
    db.query(queryUsuario, [idusuario], (err, results) => {
        if (err) return callback(err);
        if (results.length === 0) return callback(new Error('Usuario no encontrado'));

        const usuario = results[0];
        const userURI = $rdf.sym(`http://example.org/usuario/${usuario.id}`);

        store.add(userURI, FOAF('name'), $rdf.literal(usuario.UserName));
        store.add(userURI, FOAF('mbox'), $rdf.literal(usuario.Correo));

        // 2. Comentarios hechos por el usuario
        const queryComentarios = `SELECT * FROM comentarios WHERE idusuario = ?`;
        db.query(queryComentarios, [usuario.id], (err, comentarios) => {
            if (err) return callback(err);

            comentarios.forEach(comentario => {
                const comentarioURI = $rdf.sym(`http://example.org/comentario/${comentario.idcomentarios}`);
                store.add(userURI, EX('hizoComentario'), comentarioURI);
                store.add(comentarioURI, EX('contenido'), $rdf.literal(comentario.contenido));
            });

            // 3. Likes a noticias
            const queryLikesNoticias = `SELECT * FROM likes_noticias WHERE idusuarioLI = ?`;
            db.query(queryLikesNoticias, [usuario.id], (err, likesNoticias) => {
                if (err) return callback(err);

                likesNoticias.forEach(like => {
                    const noticiaURI = $rdf.sym(`http://example.org/noticia/${like.idnoticiaLI}`);
                    store.add(userURI, EX('userDaLikeNoticia'), noticiaURI);
                });

                // 4. Historial de noticias vistas
                const queryHistorialNoticias = `SELECT * FROM historialnoticias WHERE idusuarioHN = ?`;
                db.query(queryHistorialNoticias, [usuario.id], (err, historial) => {
                    if (err) return callback(err);

                    historial.forEach(entry => {
                        const noticiaURI = $rdf.sym(`http://example.org/noticia/${entry.idnoticiaHN}`);
                        store.add(userURI, EX('haVistoNoticia'), noticiaURI);
                    });

                    // 5. Historial de comentarios vistos
                    const queryHistorialComentarios = `SELECT * FROM historialcomentarios WHERE idusuarioHC = ?`;
                    db.query(queryHistorialComentarios, [usuario.id], (err, historialComent) => {
                        if (err) return callback(err);

                        historialComent.forEach(entry => {
                            const comentarioURI = $rdf.sym(`http://example.org/comentario/${entry.idcomentariosHC}`);
                            store.add(userURI, EX('haVistoComentario'), comentarioURI);
                        });

                        // 6. Serializar y guardar RDF y TTL
                        const ttl = new $rdf.Serializer(store).toN3(store);
                        $rdf.serialize(null, store, "http://example.org/", "application/rdf+xml", (err, rdfXml) => {
                            if (err) return callback(err);

                            fs.writeFile(ttlPath, ttl, (err) => {
                                if (err) return callback(err);
                                fs.writeFile(rdfPath, rdfXml, (err) => {
                                    if (err) return callback(err);
                                    callback(null); // Éxito
                                });
                            });
                        });
                    });
                });
            });
        });
    });
}
app.get("/usuario", (req, res) => {
  const correo = req.query.correo;

  if (!correo) {
    return res.status(400).json({ error: "Correo no proporcionado" });
  }

  const query = `SELECT UserName, Correo, Dia, Mes, Anio FROM usuario WHERE Correo = ?`;
  
  db.query(query, [correo], (err, results) => {
    if (err) {
      console.error("Error al buscar usuario:", err);
      return res.status(500).json({ error: "Error interno del servidor" });
    }

    if (results.length > 0) {
      const usuario = results[0];
      res.status(200).json(usuario);
    } else {
      res.status(404).json({ error: "Usuario no encontrado" });
    }
  });
});


//SECTION REGISTRO DE USUARIO
app.post('/signup', async (req, res) => {
    console.log("BODY RECIBIDO:", req.body);
    const { UserName, Correo, Contrasena, Dia, Mes, Anio } = req.body;

    try {
        const hashedPassword = await bcrypt.hash(Contrasena, 10); // 10 es el salt rounds

        const query = `INSERT INTO usuario (UserName, Correo, Contrasena, Dia, Mes, Anio) VALUES (?, ?, ?, ?, ?, ?)`;
        db.query(query, [UserName, Correo, hashedPassword, Dia, Mes, Anio], (err, result) => {
            if (!UserName || !Correo || !Contrasena || !Dia || !Mes || !Anio) {
                return res.status(400).json({ error: 'Faltan campos requeridos' });
              }              
            
            if (err) {
                console.error('Error al registrar usuario:', err);
                return res.status(500).json({ 
                    error: 'Error al registrar usuario',
                    code: err.code,
                    detail: err.sqlMessage,
                });
            }
            res.status(200).json({ message: 'Usuario registrado exitosamente' });
        });
    } catch (err) {
        console.error('Error al encriptar contraseña:', err);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});
//SECCION DE LOGUEO
app.post('/login', (req, res) => {
    const { Correo, Contrasena } = req.body;

    const query = `SELECT * FROM usuario WHERE Correo = ?`;
    db.query(query, [Correo], async (err, results) => {
        if (err) {
            console.error('Error en login:', err);
            return res.status(500).json({ error: 'Error en login' });
        }

        if (results.length > 0) {
            const usuario = results[0];
            const match = await bcrypt.compare(Contrasena, usuario.Contrasena);

            if (match) {
                //console.log("ID del usuario recuperado del login:", usuario.id); // CORREGIDO
                generarTripletasUsuario(usuario.id, (err) => { // CORREGIDO
                    if (err) {
                        console.error('Error generando RDF del usuario:', err);
                        return res.status(500).json({ error: 'Error generando RDF' });
                    }

                    res.status(200).json({
                        message: 'Login exitoso',
                        usuario,
                        rdf_path: `/ontologia/dinamico/${usuario.id}` // CORREGIDO
                    });
                });

            } else {
                res.status(401).json({ error: 'Contraseña incorrecta' });
            }
        } else {
            res.status(401).json({ error: 'Correo no encontrado' });
        }
    });
});
//SECCION NOTICIAS 
app.post('/noticias', (req, res) => {
    const { titulo, contenido, categoria, autor, fecha_publicacion, LIKES } = req.body;

    const query = `INSERT INTO noticias (titulo, contenido, categoria, autor, fecha_publicacion, LIKES)
                   VALUES (?, ?, ?, ?,?, ?)`;

    db.query(query, [titulo, contenido, categoria, autor, fecha_publicacion, LIKES], (err, result) => {
        if (err) {
            console.error('Error al insertar noticia', err);
            return res.status(500).json({ error: 'Error al insertar la noticia' });
        }
        res.status(200).json({ message: 'NOTICIA registrado exitosamente' });
    });
});
    app.get('/api/noticias', (req, res) => { //este es para mi buscador 
    const keyword = req.query.keyword || '';
    const sql = 'SELECT * FROM noticias WHERE tags LIKE ?';
    const values = [`%${keyword}%`];

    db.query(sql, values, (err, results) => {
        if (err) {
        console.error('Error al obtener noticias:', err);
        return res.status(500).send('Error al buscar noticias');
        }
        res.json(results);
    });
    });
app.post('/historialnoticias', (req, res) => {
    const { fecha_vistah, idnoticiaHN, idusuarioHN } = req.body;

    // Verifica si ya existe historial con la misma noticia, usuario y fecha (solo año-mes-día)
    const checkQuery = `
      SELECT COUNT(*) AS count
      FROM historialnoticias hn
      WHERE hn.idusuarioHN = ? 
        AND hn.idnoticiaHN = ?
        AND DATE(hn.fecha_vistah) = DATE(?)
    `;

    db.query(checkQuery, [idusuarioHN, idnoticiaHN, fecha_vistah], (err, results) => {
        if (err) {
            console.error('Error al verificar historial existente:', err);
            return res.status(500).json({ error: 'Error al verificar historial existente' });
        }

        if (results[0].count > 0) {
            // Ya existe un registro igual en ese día, no insertar duplicado
            return res.status(200).json({ message: 'Registro duplicado, no insertado' });
        }

        // Si no existe, insertar el nuevo registro
        const insertQuery = `
          INSERT INTO historialnoticias (fecha_vistah, idnoticiaHN, idusuarioHN)
          VALUES (?, ?, ?)
        `;

        db.query(insertQuery, [fecha_vistah, idnoticiaHN, idusuarioHN], (err2, result) => {
            if (err2) {
                console.error('Error al insertar historial:', err2);
                return res.status(500).json({ error: 'Error al insertar historial' });
            }
            res.status(200).json({ message: 'Historial de noticias registrado exitosamente' });
        });
    });
});
app.get('/historialnoticias/:idusuario', (req, res) => { 
    const idusuario = req.params.idusuario;

    const query = `SELECT hn.*, n.titulo, n.categoria
                   FROM historialnoticias hn
                   JOIN noticias n ON hn.idnoticiaHN = n.idnoticias
                   WHERE hn.idusuarioHN = ?
                   ORDER BY hn.fecha_vistah DESC`;

    db.query(query, [idusuario], (err, results) => {
        if (err) {
            console.error('Error al obtener historial de noticias:', err);
            return res.status(500).json({ error: 'Error al obtener historial' });
        }
        res.status(200).json(results);
    });
});
app.get('/historialnoticias/usuario/:idusuarioHN', (req, res) => {
    const idusuarioHN = req.params.idusuarioHN;

    const query = `
        SELECT h.IDHISTONOTI, h.fecha_vistah, n.idnoticias, n.titulo, n.autor
        FROM historialnoticias h
        JOIN noticias n ON h.idnoticiaHN = n.idnoticias
        WHERE h.idusuarioHN = ?
        ORDER BY h.fecha_vistah DESC
    `;

    db.query(query, [idusuarioHN], (err, results) => {
        if (err) {
            console.error('Error al obtener historial de noticias:', err);
            return res.status(500).json({ error: 'Error al obtener historial de noticias' });
        }

        res.status(200).json({ historial: results });
    });
});
app.get('/noticias', (req, res) => {
    const query = 'SELECT * FROM noticias ORDER BY fecha_publicacion DESC';

    db.query(query, (err, results) => {
        if (err) {
            console.error('Error al obtener noticias:', err);
            return res.status(500).json({ error: 'Error al obtener noticias' });
        }
        res.status(200).json(results);
    });
});
app.get('/noticias/:id', (req, res) => {
  const query = `
    SELECT 
      n.*, 
      n.LIKES AS total_likes /* Usa SOLO el valor almacenado */
    FROM noticias n
    WHERE idnoticias = ?
  `;
  
  db.query(query, [req.params.id], (err, results) => {
    if (err) return res.status(500).json({ error: 'Error en la consulta' });
    res.status(200).json(results[0]);
  });
});
//SECTION COMENTARIOS
app.post('/comentarios', (req, res) => {
    const data = req.body;

    const sql = `INSERT INTO comentarios (contenido, fechacoment, idusuario, idnoticias) VALUES (?, ?, ?, ?)`;

    db.query(sql, [data.contenido, data.fechacoment, data.idusuario, data.idnoticias], (err, result) => {
        if (err) {
            console.error('Error al insertar comentario:', err);
            res.status(500).json({ error: 'Error al insertar comentario' });
        } else {
            // Generar las tripletas RDF después del comentario
            generarTripletasUsuario(data.idusuario, (err, msg) => {
                if (err) {
                    console.error('Error generando tripletas RDF:', err);
                    return res.status(500).json({ error: 'Comentario guardado, pero error generando RDF' });
                }

                res.json({
                    idcomentarios: result.insertId,
                    message: 'Comentario guardado y RDF actualizado'
                });
            });
        }
    });
}); 



app.get('/comentarios/:idnoticia', (req, res) => {
  const idnoticia = req.params.idnoticia;
  const sql = `
    SELECT 
      c.idcomentarios,
      c.idnoticias,
      u.id AS idusuario,  
      u.UserName AS username,
      c.fechacoment AS fechacoment,
      c.contenido
    FROM comentarios c
    JOIN usuario u ON c.idusuario = u.id
    WHERE c.idnoticias = ?
  `;

  db.query(sql, [idnoticia], (err, result) => {
    if (err) {
      console.error('Error al obtener comentarios con usuario:', err);
      return res.status(500).json({ error: 'Error interno del servidor' });
    }
    res.json(result);
  });
});

app.post('/historialcomentarios', (req, res) => {
    let { fecha_vista, idnoticiaHC, idusuarioHC, idcomentariosHC } = req.body;

    // Si no se pasa la fecha, se usa la actual
    if (!fecha_vista) {
        const hoy = new Date();
        fecha_vista = hoy.toISOString().slice(0, 19).replace('T', ' ');
    }

    const query = `
        INSERT INTO historialcomentarios 
        (fecha_vista, idnoticiaHC, idusuarioHC, idcomentariosHC)
        VALUES (?, ?, ?, ?)
    `;

    db.query(query, [fecha_vista, idnoticiaHC, idusuarioHC, idcomentariosHC], (err, result) => {
        if (err) {
            console.error('Error al insertar historial de comentarios:', err);
            return res.status(500).json({ error: 'Error al insertar el historial de comentarios' });
        }
        res.status(200).json({ message: 'Historial de comentarios registrado exitosamente' });
    });
});
app.get('/historialcomentarios/:id', (req, res) => {
    const userId = req.params.id;
  
    const sql = `
      SELECT hc.*, c.contenido, n.titulo
      FROM historialcomentarios hc
      LEFT JOIN comentarios c ON hc.idcomentariosHC = c.idcomentarios
      LEFT JOIN noticias n ON hc.idnoticiaHC = n.idnoticias
      WHERE hc.idusuarioHC = ?
      ORDER BY hc.fecha_vista DESC
    `;
  
    db.query(sql, [userId], (err, results) => {
      if (err) {
        console.error('Error al obtener historial:', err);
        res.status(500).json({ error: 'Error en el servidor' });
      } else {
        res.json(results);
      }
    });
});
//SECTION LIKES:
app.post('/likes', (req, res) => {
  const { idusuarioLI, idnoticiaLI } = req.body;

  // Verificar si ya dio like antes
  const checkQuery = `SELECT * FROM likes_noticias WHERE idusuarioLI = ? AND idnoticiaLI = ?`;
  db.query(checkQuery, [idusuarioLI, idnoticiaLI], (err, result) => {
    if (err) return res.status(500).send(err);
    if (result.length > 0) {
      return res.status(400).json({ message: 'Ya diste like a esta noticia' });
    }

    const insertQuery = `INSERT INTO likes_noticias (idusuarioLI, idnoticiaLI, fecha_like) VALUES (?, ?, NOW())`;
    db.query(insertQuery, [idusuarioLI, idnoticiaLI], (err, result) => {
      if (err) return res.status(500).send(err);

      // Actualizar contador de likes en la tabla noticias
      const updateQuery = `UPDATE noticias SET LIKES = LIKES + 1 WHERE idnoticias = ?`;
      db.query(updateQuery, [idnoticiaLI], (err) => {
        if (err) return res.status(500).send(err);
        res.status(200).json({ message: 'Like agregado con éxito' });
      });
    });
  });
});
app.delete('/likes', (req, res) => {
  const { idusuarioLI, idnoticiaLI } = req.body;

  const deleteQuery = `DELETE FROM likes_noticias WHERE idusuarioLI = ? AND idnoticiaLI = ?`;
  db.query(deleteQuery, [idusuarioLI, idnoticiaLI], (err, result) => {
    if (err) return res.status(500).send(err);
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Like no encontrado' });
    }

    const updateQuery = `UPDATE noticias SET LIKES = LIKES - 1 WHERE idnoticias = ?`;
    db.query(updateQuery, [idnoticiaLI], (err) => {
      if (err) return res.status(500).send(err);
      res.status(200).json({ message: 'Like eliminado con éxito' });
    });
  });
});
app.get('/likes/:idusuario', (req, res) => {
  const idusuario = req.params.idusuario;

  const query = `SELECT * FROM likes_noticias WHERE idusuarioLI = ?`;
  db.query(query, [idusuario], (err, result) => {
    if (err) return res.status(500).send(err);
    res.status(200).json(result);
  });
});
app.get('/likes/usuario/:idusuario', (req, res) => {
  const idusuario = req.params.idusuario;
  const query = 'SELECT * FROM likes_noticias WHERE idusuarioLI = ?';
  db.query(query, [idusuario], (err, result) => {
    if (err) return res.status(500).send(err);
    res.json(result);
  });
});
app.get('/api/noticias/:id/LIKES', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT LIKES FROM noticias WHERE idnoticias = ?',
      [req.params.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Noticia no encontrada' });
    }

    res.json({ likes: rows[0].likes });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});
//SECTION ONTOLOGIAS:
app.get('/ontologia/general', (req, res) => {
    const ttlPath = path.join(__dirname, 'ontologia', 'general.ttl');
    fs.readFile(ttlPath, 'utf8', (err, data) => {
        if (err) return res.status(500).json({ error: 'No se pudo cargar la ontología general' });
        res.set('Content-Type', 'text/turtle');
        res.send(data);
    });
});
app.get('/ontologia/usuario', (req, res) => {
    const ttlPath = path.join(__dirname, 'ontologia', 'usuario.ttl');

    fs.readFile(ttlPath, 'utf8', (err, data) => {
        if (err) {
            console.error('Error al leer ontología:', err);
            return res.status(500).json({ error: 'No se pudo cargar la ontología del usuario' });
        }

        // Cargar los datos en un grafo RDF usando rdflib
        const store = $rdf.graph();
        try {
            $rdf.parse(data, store, 'http://example.org/ontology#', 'text/turtle');
            res.set('Content-Type', 'text/turtle');
            res.send(data);
        } catch (parseErr) {
            console.error('Error al parsear el RDF:', parseErr);
            res.status(500).json({ error: 'Ontología mal formada' });
        }
    });
});
app.get('/ontologia/publicacion', (req, res) => {
    const ttlPath = path.join(__dirname, 'ontologia', 'publicacion.ttl');

    fs.readFile(ttlPath, 'utf8', (err, data) => {
        if (err) {
            console.error('Error al leer ontología:', err);
            return res.status(500).json({ error: 'No se pudo cargar la ontología de publicación' });
        }

        // Cargar los datos en un grafo RDF usando rdflib
        const store = $rdf.graph();
        try {
            $rdf.parse(data, store, 'http://example.org/ontology#', 'text/turtle');
            res.set('Content-Type', 'text/turtle');
            res.send(data);
        } catch (parseErr) {
            console.error('Error al parsear el RDF:', parseErr);
            res.status(500).json({ error: 'Ontología mal formada' });
        }
    });
});
app.get('/ontologia/comentarios', (req, res) => {
    const ttlPath = path.join(__dirname, 'ontologia', 'comentarios.ttl');

    fs.readFile(ttlPath, 'utf8', (err, data) => {
        if (err) return res.status(500).json({ error: 'No se pudo cargar la ontología de comentarios' });

        const store = $rdf.graph();
        try {
            $rdf.parse(data, store, 'http://example.org/ontology#', 'text/turtle');
            res.set('Content-Type', 'text/turtle');
            res.send(data);
        } catch {
            res.status(500).json({ error: 'Ontología mal formada' });
        }
    });
});
app.get('/ontologia/historialcomentarios', (req, res) => {
    const ttlPath = path.join(__dirname, 'ontologia', 'historialcomentarios.ttl');

    fs.readFile(ttlPath, 'utf8', (err, data) => {
        if (err) return res.status(500).json({ error: 'No se pudo cargar la ontología del historial de comentarios' });

        const store = $rdf.graph();
        try {
            $rdf.parse(data, store, 'http://example.org/ontology#', 'text/turtle');
            res.set('Content-Type', 'text/turtle');
            res.send(data);
        } catch {
            res.status(500).json({ error: 'Ontología mal formada' });
        }
    });
});
// Ruta para generar tripletas RDF de instancias de usuarios
app.get('/rdf/usuarios', (req, res) => {
    const consulta = 'SELECT * FROM usuario';
    db.query(consulta, (err, resultados) => {
        if (err) {
            console.error('Error al consultar usuarios:', err);
            return res.status(500).send('Error al generar RDF');
        }

        let rdf = `@prefix : <http://example.org/ontology#> .\n`;
        rdf += `@prefix user: <http://example.org/usuario#> .\n`;
        rdf += `@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\n\n`;

        resultados.forEach((usuario) => {
            rdf += `user:usuario${usuario.idusuario} a :Usuario ;\n`;
            rdf += `    :UserName "${usuario.UserName}" ;\n`;
            rdf += `    :Correo "${usuario.Correo}" ;\n`;
            rdf += `    :Contrasena "${usuario.Contrasena}" ;\n`;
            rdf += `    :Dia "${usuario.Dia}"^^xsd:int ;\n`;
            rdf += `    :Mes "${usuario.Mes}"^^xsd:int ;\n`;
            rdf += `    :Anio "${usuario.Anio}"^^xsd:int .\n\n`;
        });

        const rutaTtl = path.join(__dirname, 'ontologia', 'instancias', 'usuarios.ttl');
        const rutaXml = path.join(__dirname, 'ontologia', 'instancias', 'usuarios.rdf');

        const dir = path.dirname(rutaTtl);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        // Guardar el archivo TTL
        fs.writeFileSync(rutaTtl, rdf);

        // Convertir TTL a RDF/XML usando rdflib
        const store = $rdf.graph();
        const contentType = 'text/turtle';
        const baseUri = 'http://example.org/usuario#';

        $rdf.parse(rdf, store, baseUri, contentType);

        const rdfXml = $rdf.serialize(null, store, baseUri, 'application/rdf+xml');

        // Guardar RDF/XML
        fs.writeFileSync(rutaXml, rdfXml);

        console.log('Archivos TTL y RDF guardados correctamente.');
        res.set('Content-Type', 'text/turtle');
        res.send(rdf);
    });
});
// PUBLICACIONES
app.get('/rdf/publicaciones', (req, res) => {
    const consulta = 'SELECT * FROM noticias';
    db.query(consulta, (err, resultados) => {
        if (err) {
            console.error('Error al consultar publicaciones:', err);
            return res.status(500).send('Error al generar RDF de publicaciones');
        }

        let rdf = `@prefix : <http://example.org/ontology#> .\n`;
        rdf += `@prefix pub: <http://example.org/publicacion#> .\n`;
        rdf += `@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\n\n`;

        resultados.forEach((publi) => {
            rdf += `pub:publicacion${publi.idnoticias} a :Publicacion ;\n`;
            rdf += `    :Titulo "${publi.titulo}" ;\n`;
            rdf += `    :Contenido "${publi.contenido.replace(/"/g, '\\"')}" ;\n`;
            rdf += `    :Categoria "${publi.categoria}" ;\n`;
            rdf += `    :Autor "${publi.autor}" ;\n`;
            rdf += `    :FechaPublicacion "${publi.fecha_publicacion.toISOString().split('T')[0]}"^^xsd:date ;\n`;
            rdf += `    :Likes "${publi.LIKES}"^^xsd:int .\n\n`;
        });

        const rutaTtl = path.join(__dirname, 'ontologia', 'instancias', 'publicaciones.ttl');
        const rutaXml = path.join(__dirname, 'ontologia', 'instancias', 'publicaciones.rdf');
        const dir = path.dirname(rutaTtl);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        fs.writeFileSync(rutaTtl, rdf);

        const store = $rdf.graph();
        $rdf.parse(rdf, store, 'http://example.org/publicacion#', 'text/turtle');
        const rdfXml = $rdf.serialize(null, store, 'http://example.org/publicacion#', 'application/rdf+xml');
        fs.writeFileSync(rutaXml, rdfXml);

        console.log('Publicaciones TTL y RDF guardados correctamente.');
        res.set('Content-Type', 'text/turtle');
        res.send(rdf);
    });
});
// COMENTARIOS
app.get('/rdf/comentarios', (req, res) => {
    const consulta = 'SELECT * FROM comentarios';
    db.query(consulta, (err, resultados) => {
        if (err) {
            console.error('Error al consultar comentarios:', err);
            return res.status(500).send('Error al generar RDF de comentarios');
        }

        let rdf = `@prefix : <http://example.org/ontology#> .\n`;
        rdf += `@prefix com: <http://example.org/comentario#> .\n`;
        rdf += `@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\n\n`;

        resultados.forEach((coment) => {
            rdf += `com:comentario${coment.idcomentarios} a :Comentario ;\n`;
            rdf += `    :ContenidoComent "${coment.contenido.replace(/"/g, '\\"')}" ;\n`;
            rdf += `    :FechaComent "${coment.fechacoment}"^^xsd:date ;\n`;
            rdf += `    :AutorComent com:usuario${coment.idusuario} ;\n`;
            rdf += `    :RelacionadoA com:noticia${coment.idnoticias} .\n\n`;
        });

        const rutaTtl = path.join(__dirname, 'ontologia', 'instancias', 'comentarios.ttl');
        const rutaXml = path.join(__dirname, 'ontologia', 'instancias', 'comentarios.rdf');
        const dir = path.dirname(rutaTtl);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        fs.writeFileSync(rutaTtl, rdf);

        const store = $rdf.graph();
        $rdf.parse(rdf, store, 'http://example.org/comentario#', 'text/turtle');
        const rdfXml = $rdf.serialize(null, store, 'http://example.org/comentario#', 'application/rdf+xml');
        fs.writeFileSync(rutaXml, rdfXml);

        console.log('Comentarios TTL y RDF guardados correctamente.');
        res.set('Content-Type', 'text/turtle');
        res.send(rdf);
    });
});
app.get('/rdf/historialnoticias', (req, res) => {
    const consulta = 'SELECT * FROM historialnoticias';
    db.query(consulta, (err, resultados) => {
        if (err) {
            console.error('Error al consultar historialnoticias:', err);
            return res.status(500).send('Error al generar RDF de historialnoticias');
        }

        let rdf = `@prefix : <http://example.org/ontology#> .\n`;
        rdf += `@prefix hist: <http://example.org/historial#> .\n`;
        rdf += `@prefix user: <http://example.org/usuario#> .\n`;
        rdf += `@prefix pub: <http://example.org/publicacion#> .\n`;
        rdf += `@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\n\n`;

        resultados.forEach((item) => {
            rdf += `hist:historialnoticia${item.IDHISTONOTI} a :HistorialNoticia ;\n`;
            rdf += `    :fechaVista "${item.fecha_vistah}"^^xsd:dateTime ;\n`;
            rdf += `    :vistoPor user:usuario${item.idusuarioHN} ;\n`;
            rdf += `    :vistoSobre pub:publicacion${item.idnoticiaHN} .\n\n`;
        });

        const rutaTtl = path.join(__dirname, 'ontologia', 'instancias', 'historialnoticias.ttl');
        const rutaXml = path.join(__dirname, 'ontologia', 'instancias', 'historialnoticias.rdf');
        const dir = path.dirname(rutaTtl);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        fs.writeFileSync(rutaTtl, rdf);

        const store = $rdf.graph();
        $rdf.parse(rdf, store, 'http://example.org/historial#', 'text/turtle');
        const rdfXml = $rdf.serialize(null, store, 'http://example.org/historial#', 'application/rdf+xml');
        fs.writeFileSync(rutaXml, rdfXml);

        console.log('HistorialNoticias TTL y RDF guardados correctamente.');
        res.set('Content-Type', 'text/turtle');
        res.send(rdf);
    });
});
app.get('/rdf/likesnoticias', (req, res) => {
    const consulta = 'SELECT * FROM likes_noticias';
    db.query(consulta, (err, resultados) => {
        if (err) {
            console.error('Error al consultar likes_noticias:', err);
            return res.status(500).send('Error al generar RDF de likes_noticias');
        }

        let rdf = `@prefix : <http://example.org/ontology#> .\n`;
        rdf += `@prefix like: <http://example.org/like#> .\n`;
        rdf += `@prefix user: <http://example.org/usuario#> .\n`;
        rdf += `@prefix pub: <http://example.org/publicacion#> .\n`;
        rdf += `@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\n\n`;

        resultados.forEach((item) => {
            rdf += `like:like${item.IDlikes} a :LikeNoticia ;\n`;
            rdf += `    :fechaLike "${item.fecha_like}"^^xsd:dateTime ;\n`;
            rdf += `    :dadoPor user:usuario${item.idusuarioLI} ;\n`;
            rdf += `    :dadoASobre pub:publicacion${item.idnoticiaLI} .\n\n`;
        });

        const rutaTtl = path.join(__dirname, 'ontologia', 'instancias', 'likesnoticias.ttl');
        const rutaXml = path.join(__dirname, 'ontologia', 'instancias', 'likesnoticias.rdf');
        const dir = path.dirname(rutaTtl);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        fs.writeFileSync(rutaTtl, rdf);

        const store = $rdf.graph();
        $rdf.parse(rdf, store, 'http://example.org/like#', 'text/turtle');
        const rdfXml = $rdf.serialize(null, store, 'http://example.org/like#', 'application/rdf+xml');
        fs.writeFileSync(rutaXml, rdfXml);

        console.log('LikesNoticias TTL y RDF guardados correctamente.');
        res.set('Content-Type', 'text/turtle');
        res.send(rdf);
    });
});
// HISTORIAL DE COMENTARIOS
app.get('/rdf/historialcomentarios', (req, res) => {
    const consulta = 'SELECT * FROM historialcomentarios';
    db.query(consulta, (err, resultados) => {
        if (err) {
            console.error('Error al consultar historial:', err);
            return res.status(500).send('Error al generar RDF de historial de comentarios');
        }

        let rdf = `@prefix : <http://example.org/ontology#> .\n`;
        rdf += `@prefix hist: <http://example.org/historial#> .\n`;
        rdf += `@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\n\n`;

        resultados.forEach((item) => {
            rdf += `hist:historial${item.idhistorialHC} a :HistorialComentario ;\n`;
            rdf += `    :FechaVista "${item.fecha_vista}"^^xsd:dateTime ;\n`;
            rdf += `    :UsuarioVista hist:usuario${item.idusuarioHC} ;\n`;
            rdf += `    :NoticiaVista hist:noticia${item.idnoticiaHC} ;\n`;
            rdf += `    :ComentarioVisto hist:comentario${item.idcomentariosHC} .\n\n`;
        });

        const rutaTtl = path.join(__dirname, 'ontologia', 'instancias', 'historialcomentarios.ttl');
        const rutaXml = path.join(__dirname, 'ontologia', 'instancias', 'historialcomentarios.rdf');
        const dir = path.dirname(rutaTtl);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        fs.writeFileSync(rutaTtl, rdf);

        const store = $rdf.graph();
        $rdf.parse(rdf, store, 'http://example.org/historial#', 'text/turtle');
        const rdfXml = $rdf.serialize(null, store, 'http://example.org/historial#', 'application/rdf+xml');
        fs.writeFileSync(rutaXml, rdfXml);

        console.log('HistorialComentarios TTL y RDF guardados correctamente.');
        res.set('Content-Type', 'text/turtle');
        res.send(rdf);
    });
});
//muy editado jajaj
app.get('/ontologia/dinamico/:idusuario', (req, res) => {
    const { idusuario } = req.params;
    console.log(`Request recibido para RDF de usuario ${idusuario}`);

    const consultaUsuario = 'SELECT * FROM usuario WHERE id = ?';
    const consultaHistorialNoticias = 'SELECT * FROM historialnoticias WHERE idusuarioHN = ?';
    const consultaLikesNoticias = 'SELECT * FROM likes_noticias WHERE idusuarioLI = ?';
    const consultaComentarios = 'SELECT * FROM comentarios WHERE idusuario = ?';
    //const consultaHistorialComentarios = 'SELECT * FROM historialcomentarios WHERE idusuarioHC = ?';

    db.query(consultaUsuario, [idusuario], (errUsuario, resUsuario) => {
        if (errUsuario || resUsuario.length === 0) return res.status(500).send('Error al obtener usuario');
        console.log("Usuario encontrado:", resUsuario);
        db.query(consultaHistorialNoticias, [idusuario], (errHN, resHN) => {
            if (errHN) return res.status(500).send('Error al obtener historial noticias');
            
            console.log("Historial noticias:", resHN);
            db.query(consultaLikesNoticias, [idusuario], (errLikes, resLikes) => {
                if (errLikes) return res.status(500).send('Error al obtener likes noticias');
                console.log("Likes noticias:", resLikes);
                db.query(consultaComentarios, [idusuario], (errCom, resCom) => {
                    if (errCom) return res.status(500).send('Error al obtener comentarios');
                    console.log("Comentarios:", resCom);
                    //db.query(consultaHistorialComentarios, [idusuario], (errHC, resHC) => {
                        //if (errHC) return res.status(500).send('Error al obtener historial comentarios');
                        //console.log("Historial comentarios:", resHC);
                        // OK → armar el TTL completo
                        let rdf = `@prefix : <http://example.org/ontology#> .\n`;
                        rdf += `@prefix user: <http://example.org/usuario#> .\n`;
                        rdf += `@prefix pub: <http://example.org/publicacion#> .\n`;
                        rdf += `@prefix like: <http://example.org/like#> .\n`;
                        rdf += `@prefix hist: <http://example.org/historial#> .\n`;
                        rdf += `@prefix com: <http://example.org/comentario#> .\n`;
                        rdf += `@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\n\n`;

                        // Usuario
                        resUsuario.forEach((usuario) => {
                            rdf += `user:usuario${usuario.id} a :Usuario ;\n`;
                            rdf += `    :UserName "${usuario.UserName}" ;\n`;
                            //rdf += `    :Correo "${usuario.Correo}" ;\n`;
                            //rdf += `    :Contrasena "${usuario.Contrasena}" ;\n`;
                            rdf += `    :Dia "${usuario.Dia}"^^xsd:int ;\n`;
                            rdf += `    :Mes "${usuario.Mes}"^^xsd:int ;\n`;
                            rdf += `    :Anio "${usuario.Anio}"^^xsd:int .\n\n`;
                        });

                        // Historial noticias
                        resHN.forEach((item) => {
                            rdf += `hist:historialnoticia${item.IDHISTONOTI} a :HistorialNoticia ;\n`;
                            rdf += `    :fechaVista "${item.fecha_vistah}"^^xsd:dateTime ;\n`;
                            rdf += `    :vistoPor user:usuario${item.idusuarioHN} ;\n`;
                            rdf += `    :vistoSobre pub:publicacion${item.idnoticiaHN} .\n\n`;
                        });

                        // Likes noticias
                        resLikes.forEach((item) => {
                            rdf += `like:like${item.IDlikes} a :LikeNoticia ;\n`;
                            rdf += `    :fechaLike "${item.fecha_like}"^^xsd:dateTime ;\n`;
                            rdf += `    :dadoPor user:usuario${item.idusuarioLI} ;\n`;
                            rdf += `    :dadoASobre pub:publicacion${item.idnoticiaLI} .\n\n`;
                        });

                        // Comentarios
                        resCom.forEach((coment) => {
                            rdf += `com:comentario${coment.idcomentarios} a :Comentario ;\n`;
                            rdf += `    :ContenidoComent "${coment.contenido.replace(/"/g, '\\"')}" ;\n`;
                            rdf += `    :FechaComent "${coment.fechacoment}"^^xsd:date ;\n`;
                            rdf += `    :AutorComent user:usuario${coment.idusuario} ;\n`;
                            rdf += `    :RelacionadoA pub:publicacion${coment.idnoticias} .\n\n`;
                        });

                        // Historial comentarios
                        /*
                        resHC.forEach((item) => {
                            rdf += `hist:historialcomentario${item.idhistorialHC} a :HistorialComentario ;\n`;
                            rdf += `    :FechaVista "${item.fecha_vista}"^^xsd:dateTime ;\n`;
                            rdf += `    :UsuarioVista user:usuario${item.idusuarioHC} ;\n`;
                            rdf += `    :NoticiaVista pub:publicacion${item.idnoticiaHC} ;\n`;
                            rdf += `    :ComentarioVisto com:comentario${item.idcomentariosHC} .\n\n`;
                        });*/

                        // Guardar el RDF generado
                        const dir = path.join(__dirname, 'ontologia', 'each_user');
                        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

                        const ttlPath = path.join(dir, `usuario_${idusuario}.ttl`);
                        fs.writeFileSync(ttlPath, rdf);

                        console.log(`Ontología dinámica de usuario ${idusuario} generada.`);

                        res.attachment(`usuario_${idusuario}.ttl`);
                        res.send(rdf);

                });
            });
        });
    });
});



