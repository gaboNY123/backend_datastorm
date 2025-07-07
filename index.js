const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const mysql = require('mysql');
const bcrypt = require('bcryptjs');

const fs = require('fs');
const $rdf = require('rdflib');
const path = require('path');

const app = express();
const PORT = 3000;

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




