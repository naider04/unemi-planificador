import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import * as cheerio from 'cheerio';
import * as fs from 'fs';

const app = express();
const PORT = 3000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Helper to extract session cookies
function getSetCookies(headers: Headers): string[] {
  if (typeof headers.getSetCookie === 'function') {
    return headers.getSetCookie();
  }
  const setCookie = headers.get('set-cookie');
  return setCookie ? [setCookie] : [];
}

// Spanish Month Parser Helper
function parseMoodleSpanishDate(dateStr: string): string | null {
  if (!dateStr) return null;
  try {
    const cleanStr = dateStr.toLowerCase()
      .replace(/de\s+/g, '') // remove "de"
      .replace(/,\s*/g, ' ') // remove commas
      .trim();
    
    const months: Record<string, number> = {
      enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5,
      julio: 6, agosto: 7, septiembre: 8, octubre: 9, noviembre: 10, diciembre: 11,
      january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
      july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
      jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
    };

    // 1. Find the month
    let monthVal = -1;
    const parts = cleanStr.split(/\s+/);
    for (const part of parts) {
      if (months[part] !== undefined) {
        monthVal = months[part];
        break;
      }
    }

    if (monthVal === -1) {
      // Fallback to standard javascript parser
      const parsed = Date.parse(dateStr);
      if (isNaN(parsed)) return null;
      return new Date(parsed).toISOString();
    }

    // 2. Extract Year (4-digit number like 2024, 2025, 2026)
    const yearMatch = cleanStr.match(/\b(20\d{2})\b/);
    const yearVal = yearMatch ? parseInt(yearMatch[1], 10) : new Date().getFullYear();

    // 3. Extract Day
    let dayVal = NaN;
    const numberMatches = cleanStr.match(/\b\d{1,2}\b/g);
    if (numberMatches) {
      for (const numStr of numberMatches) {
        const val = parseInt(numStr, 10);
        // Ensure day is 1-31
        if (val >= 1 && val <= 31) {
          dayVal = val;
          break;
        }
      }
    }

    if (isNaN(dayVal)) {
      dayVal = 1; // absolute fallback
    }

    // 4. Extract Time (HH:MM or H:MM)
    const timeMatch = cleanStr.match(/\b(\d{1,2}):(\d{2})\b/);
    let hour = 0;
    let min = 0;
    if (timeMatch) {
      hour = parseInt(timeMatch[1], 10);
      min = parseInt(timeMatch[2], 10);
    }

    // 5. Adjust for 12-hour format (AM/PM)
    const isPM = cleanStr.includes('p.m.') || cleanStr.includes('pm') || cleanStr.includes('p. m.') || cleanStr.includes('p. m') || cleanStr.includes('tarde') || cleanStr.includes('noche');
    const isAM = cleanStr.includes('a.m.') || cleanStr.includes('am') || cleanStr.includes('a. m.') || cleanStr.includes('a. m') || cleanStr.includes('mañana');

    if (isPM && hour < 12) {
      hour += 12;
    } else if (isAM && hour === 12) {
      hour = 0;
    }

    const pad = (num: number) => String(num).padStart(2, '0');
    // Build ISO string in America/Guayaquil (GMT-5)
    const dateStrISO = `${yearVal}-${pad(monthVal + 1)}-${pad(dayVal)}T${pad(hour)}:${pad(min)}:00-05:00`;
    const dateObj = new Date(dateStrISO);
    return isNaN(dateObj.getTime()) ? null : dateObj.toISOString();
  } catch (error) {
    console.error('Error parsing spanish date:', dateStr, error);
    return null;
  }
}

// 1. API: Moodle Login proxy
app.post('/api/moodle/login', async (req, res) => {
  const { username, password, server } = req.body;
  if (!username || !password || !server) {
    return res.status(400).json({ error: 'Faltan credenciales o servidor' });
  }

  const base = server === 'a' ? 'https://aulagradoa.unemi.edu.ec' : 'https://aulagradob.unemi.edu.ec';

  try {
    const loginUrl = `${base}/login/index.php`;

    // Fetch login index page to get logintoken
    const getRes = await fetch(loginUrl, {
      headers: { 'User-Agent': UA }
    });
    const getHtml = await getRes.text();
    const $ = cheerio.load(getHtml);

    const logintoken = $('input[name="logintoken"]').val() as string || '';
    const formAction = $('form').first().attr('action') || '/login/index.php';
    const postUrl = formAction.startsWith('http') ? formAction : new URL(formAction, base).toString();

    // Prepare credentials POST
    const formData = new URLSearchParams();
    formData.append('username', username);
    formData.append('password', password);
    formData.append('logintoken', logintoken);

    const initialCookies = getSetCookies(getRes.headers);
    const postHeaders: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': UA,
    };

    if (initialCookies.length > 0) {
      postHeaders['Cookie'] = initialCookies.map(c => c.split(';')[0]).join('; ');
    }

    const postRes = await fetch(postUrl, {
      method: 'POST',
      headers: postHeaders,
      body: formData.toString(),
      redirect: 'manual'
    });

    let newCookies = getSetCookies(postRes.headers);
    if (newCookies.length === 0 && initialCookies.length > 0) {
      newCookies = initialCookies;
    }

    const cookieString = newCookies.map(c => c.split(';')[0]).join('; ');

    // Verify session
    const verifyUrl = `${base}/my/`;
    try {
      const verifyHtml = await fetchMoodleHtml(verifyUrl, cookieString);

      const isConnected = verifyHtml.includes('Área personal') || 
                          verifyHtml.includes('Dashboard') || 
                          verifyHtml.includes('course/view.php') ||
                          verifyHtml.includes('nav-link') ||
                          !verifyHtml.includes('username');

      if (isConnected) {
        return res.json({
          success: true,
          moodleSession: cookieString,
          server,
          base
        });
      } else {
        return res.json({
          success: false,
          error: 'Las credenciales ingresadas no son válidas o Moodle rechazó el acceso.'
        });
      }
    } catch (err: any) {
      return res.json({
        success: false,
        error: `Las credenciales ingresadas no son válidas o la sesión no se pudo establecer. (${err.message})`
      });
    }

  } catch (err: any) {
    console.error('Login error:', err);
    return res.status(500).json({ error: `Excepción de servidor: ${err.message}` });
  }
});

// Helper for fetching with Moodle cookies, manually managing redirects to prevent infinite loops
async function fetchMoodleHtml(url: string, cookieString: string, maxRedirects = 5): Promise<string> {
  let currentUrl = url;
  let redirects = 0;

  while (redirects <= maxRedirects) {
    const response = await fetch(currentUrl, {
      headers: {
        'User-Agent': UA,
        'Cookie': cookieString,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
      },
      redirect: 'manual'
    });

    const status = response.status;
    const isRedirect = status === 301 || status === 302 || status === 303 || status === 307 || status === 308;

    if (isRedirect) {
      const location = response.headers.get('location');
      if (!location) {
        throw new Error('Redirección sin encabezado de ubicación');
      }

      // If redirected to the login page, the session is expired or invalid
      if (location.includes('/login/index.php')) {
        throw new Error('La sesión de Moodle ha expirado o es inválida. Por favor, vuelva a iniciar sesión.');
      }

      // Resolve relative redirect URL
      currentUrl = location.startsWith('http') ? location : new URL(location, currentUrl).toString();
      redirects++;
      continue;
    }

    if (!response.ok) {
      throw new Error(`Error HTTP: ${status}`);
    }

    return await response.text();
  }

  throw new Error('Se excedió el límite de redirecciones al acceder a Moodle.');
}

// 2. API: Find Courses
app.post('/api/moodle/courses', async (req, res) => {
  const { moodleSession, server } = req.body;
  if (!moodleSession || !server) {
    return res.status(400).json({ error: 'Falta sesión o servidor' });
  }

  const base = server === 'a' ? 'https://aulagradoa.unemi.edu.ec' : 'https://aulagradob.unemi.edu.ec';

  try {
    const dashboardHtml = await fetchMoodleHtml(`${base}/my/`, moodleSession);
    const $ = cheerio.load(dashboardHtml);
    const courses: { id: string; text: string; url: string }[] = [];

    // Capture links matching standard courses
    $('a[href]').each((_, elem) => {
      const text = $(elem).text().trim();
      const href = $(elem).attr('href') || '';
      
      const isMoodleFormat = /\s*-\s*\[[^\]]+\]\s*-\s*/.test(text);
      const isCourseUrl = href.includes('course/view.php');

      if ((isMoodleFormat || (isCourseUrl && text.length > 6)) && !text.includes('Área personal') && !text.includes('Dashboard')) {
        const fullUrl = href.startsWith('http') ? href : new URL(href, base).toString();
        const idMatch = href.match(/id=(\d+)/);
        const id = idMatch ? idMatch[1] : href;
        
        if (!courses.some(c => c.id === id)) {
          courses.push({ id, text, url: fullUrl });
        }
      }
    });

    return res.json({ courses });
  } catch (err: any) {
    const lowerMsg = (err.message || '').toLowerCase();
    const isSessionExpired = lowerMsg.includes('expiró') || lowerMsg.includes('expirada') || lowerMsg.includes('expirado') || lowerMsg.includes('inválida') || lowerMsg.includes('invalida') || lowerMsg.includes('sesión') || lowerMsg.includes('sesion') || lowerMsg.includes('redirect');
    if (isSessionExpired) {
      console.warn('Courses expected session separation:', err.message);
      return res.status(401).json({ error: err.message });
    }
    console.error('Courses error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// 3. API: Find Course Activities & Sections
app.post('/api/moodle/course-activities', async (req, res) => {
  const { moodleSession, server, courseUrl } = req.body;
  if (!moodleSession || !server || !courseUrl) {
    return res.status(400).json({ error: 'Falta sesión, servidor o URL del curso' });
  }

  const base = server === 'a' ? 'https://aulagradoa.unemi.edu.ec' : 'https://aulagradob.unemi.edu.ec';

  try {
    const courseHtml = await fetchMoodleHtml(courseUrl, moodleSession);
    const $ = cheerio.load(courseHtml);
    
    const courseIdMatch = courseUrl.match(/id=(\d+)/);
    const courseId = courseIdMatch ? courseIdMatch[1] : '';

    const sectionUrlsToFetch: string[] = [];
    const sections: any[] = [];

    // Helper to register clean section URLs safely
    function addSectionUrl(urlStr: string, nameText: string) {
      if (!urlStr) return;
      const fullUrl = urlStr.startsWith('http') ? urlStr : new URL(urlStr, base).toString();
      
      // If we have course ID, ensure it belongs to this course and matches section or view.php
      if (courseId && (!fullUrl.includes('id=' + courseId) || (!fullUrl.includes('section=') && !fullUrl.includes('sectionid=')))) {
        return;
      }

      const cleanName = nameText
        .replace(/Tema\s+\d+/gi, '')
        .replace(/Sección\s+\d+/gi, '')
        .replace(/Unidad\s+\d+/gi, '')
        .replace(/\n/g, ' ')
        .replace(/\s+/g, ' ')
        .trim() || nameText.trim();

      if (!sections.some(s => s.url === fullUrl)) {
        sections.push({
          text: cleanName || nameText.trim() || 'Sección',
          url: fullUrl
        });
      }

      if (!sectionUrlsToFetch.includes(fullUrl)) {
        sectionUrlsToFetch.push(fullUrl);
      }
    }

    // 1. Check direct .section elements
    $('.section').each((_, elem) => {
      const sectionNameElem = $(elem).find('.sectionname, h2, h3, .section-title').first();
      const text = sectionNameElem.text().trim();
      const hrefLink = $(elem).find('a[href]').first();
      const href = hrefLink.attr('href') || '';
      if (href) {
        addSectionUrl(href, text);
      }
    });

    // 2. Discover sections from standard HTML ids like section-1
    $('[id^="section-"]').each((_, elem) => {
      const idStr = $(elem).attr('id') || '';
      const match = idStr.match(/^section-(\d+)$/);
      if (match) {
        const sectionNum = match[1];
        if (sectionNum !== '0') {
          const heading = $(elem).find('.sectionname, h2, h3, .section-title').first().text().trim();
          addSectionUrl(`${courseUrl}&section=${sectionNum}`, heading || `Sección ${sectionNum}`);
        }
      }
    });

    // 3. Scan all links on the main page containing section= or sectionid=
    $('a[href]').each((_, elem) => {
      const href = $(elem).attr('href') || '';
      const text = $(elem).text().trim();
      if (href.includes('course/view.php') && (href.includes('section=') || href.includes('sectionid='))) {
        const idMatch = href.match(/id=(\d+)/);
        if (!courseId || (idMatch && idMatch[1] === courseId)) {
          addSectionUrl(href, text || `Sección`);
        }
      }
    });

    // 4. Force/Probe first 8 sections as fallback if we found almost nothing
    if (sections.length === 0 && courseId) {
      for (let i = 1; i <= 8; i++) {
        addSectionUrl(`${courseUrl}&section=${i}`, `Sección ${i}`);
      }
    }

    const activitiesMap = new Map<string, any>();
    const sectionNameByUrl: Record<string, string> = {};
    sections.forEach(s => {
      sectionNameByUrl[s.url] = s.text;
    });

    const parseAndRegisterActivities = (html: string, defaultSection: string) => {
      const page$ = cheerio.load(html);
      
      // Method A: Standard .activity block
      page$('.activity').each((_, elem) => {
        const $activity = page$(elem);
        let link = $activity.find('a.aalink').first();
        if (link.length === 0) {
          link = $activity.find('a[href]').first();
        }
        if (link.length === 0) return;

        const url = link.attr('href') || '';
        if (!url || url.includes('course/view.php')) return; // Skip section navs

        const fullUrl = url.startsWith('http') ? url : new URL(url, base).toString();
        
        let name = '';
        const instancename = link.find('.instancename').first();
        if (instancename.length > 0) {
          const clone = instancename.clone();
          clone.find('.accesshide').remove();
          name = clone.text().trim();
        } else {
          name = link.text().trim() || $activity.text().trim();
        }

        // Handle generic labels like "Continuar" by resolving the container title header
        const testLower = name.trim().toLowerCase();
        const genericFilters = ['continuar', 'continue', 'intentar', 'iniciar', 'ver', 'entrar', 'comenzar', 'continuar el último intento'];
        if (!name || name.length < 2 || genericFilters.includes(testLower)) {
          const actualHeading = $activity.find('.activityname, .instancename, a.aalink, h3, h4, h5, .section-title').first();
          if (actualHeading.length > 0) {
            const clone = actualHeading.clone();
            clone.find('.accesshide, .sr-only').remove();
            const headingText = clone.text().trim();
            if (headingText && !genericFilters.includes(headingText.toLowerCase())) {
              name = headingText;
            }
          }
        }

        name = name.replace(/Tarea$/, '').replace(/Cuestionario$/, '').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
        if (!name || name.length < 2) return;

        const lowerName = name.toLowerCase();
        const genericWords = [
          'continuar', 'continue', 'volver', 'regresar', 
          'siguiente', 'anterior', 'atras', 'cancelar', 
          'start', 'comenzar', 'intentar', 'iniciar', 'ir a',
          'ver', 'entrar', 'access', 'descargar', 'download',
          'click', 'clic', 'aquí', 'aqui'
        ];
        if (
          genericWords.some(gen => lowerName === gen || lowerName === `${gen}...` || lowerName === `...${gen}`) ||
          lowerName.includes('volver al') ||
          lowerName.includes('regresar al') ||
          lowerName.includes('ir al ') ||
          lowerName.includes('ir a la ') ||
          lowerName.includes('siguiente actividad') ||
          lowerName.includes('actividad anterior')
        ) {
          return;
        }

        let type = 'ACTIVIDAD';
        let icon = '📚';
        if ($activity.hasClass('assign') || url.includes('/mod/assign/')) {
          type = 'TAREA';
          icon = '📝';
        } else if ($activity.hasClass('quiz') || url.includes('/mod/quiz/')) {
          type = 'CUESTIONARIO';
          icon = '📋';
        } else if ($activity.hasClass('forum') || url.includes('/mod/forum/')) {
          type = 'FORO';
          icon = '💬';
        }

        const completionStatus: string[] = [];
        $activity.find('.badge, span[class*="badge"], .completioninfo, .completion-info').each((_, badgeElem) => {
          const badgeText = page$(badgeElem).text().trim();
          if (badgeText) {
            completionStatus.push(badgeText);
          }
        });

        const parentSection = $activity.closest('.section, li.section, .course-section');
        let sectionName = defaultSection;
        if (parentSection.length > 0) {
          const heading = parentSection.find('.sectionname, h2, h3, .section-title').first();
          if (heading.length > 0) {
            sectionName = heading.text().replace(/\s+/g, ' ').trim();
          }
        }

        let closure: string | null = null;
        let closureDateISO: string | null = null;

        const datesElem = $activity.find('.activitydates, .activity-dates, [data-region="activity-dates"], .activity-dates-wrapper, .activitymeta, .activityinfo, .activity-info');
        if (datesElem.length > 0) {
          const text = datesElem.text().trim();
          const parts = text.split('\n').map(p => p.trim()).filter(Boolean);
          for (const part of parts) {
            const lowerP = part.toLowerCase();
            if (lowerP.includes('cierra') || lowerP.includes('cierre') || lowerP.includes('vence') || lowerP.includes('entrega') || lowerP.includes('vencimiento') || lowerP.includes('due') || lowerP.includes('hasta')) {
              closure = part;
              const colonIdx = part.indexOf(':');
              const rawDate = colonIdx !== -1 ? part.substring(colonIdx + 1).trim() : part.replace(/cierra|cierre|vence|vencimiento|entrega|due|hasta/gi, '').trim();
              closureDateISO = parseMoodleSpanishDate(rawDate);
              break;
            }
          }
        }

        if (!closure) {
          $activity.find('div, p, span, small').each((_, el) => {
            const elText = page$(el).text().trim();
            if (!elText || elText.length > 100) return;
            const lowerT = elText.toLowerCase();
            if (lowerT.includes('cierra:') || lowerT.includes('cierre:') || lowerT.includes('vence:') || lowerT.includes('fecha de entrega:') || lowerT.includes('vencimiento:')) {
              closure = elText;
              const colonIdx = elText.indexOf(':');
              const rawDate = elText.substring(colonIdx + 1).trim();
              closureDateISO = parseMoodleSpanishDate(rawDate);
              return false;
            }
          });
        }

        if (!activitiesMap.has(fullUrl)) {
          activitiesMap.set(fullUrl, {
            name,
            url: fullUrl,
            type,
            icon,
            section: sectionName,
            completionStatus,
            closure,
            closureDateISO
          });
        }
      });

      // Method B: Capture any assign or quiz links anywhere on the page
      page$('a[href]').each((_, elem) => {
        const href = page$(elem).attr('href') || '';
        if (!href.includes('/mod/assign/') && !href.includes('/mod/quiz/') && !href.includes('/mod/forum/')) {
          return;
        }

        const fullUrl = href.startsWith('http') ? href : new URL(href, base).toString();
        if (activitiesMap.has(fullUrl)) return;

        let name = page$(elem).text().trim();
        const instancename = page$(elem).find('.instancename').first();
        if (instancename.length > 0) {
          const clone = instancename.clone();
          clone.find('.accesshide').remove();
          name = clone.text().trim();
        }
        
        // Handle generic labels like "Continuar" by resolving the container title header
        const testLower = name.trim().toLowerCase();
        const genericFilters = ['continuar', 'continue', 'intentar', 'iniciar', 'ver', 'entrar', 'comenzar', 'continuar el último intento'];
        if (!name || name.length < 2 || genericFilters.includes(testLower)) {
          const parentActivity = page$(elem).closest('.activity');
          if (parentActivity.length > 0) {
            const actualHeading = parentActivity.find('.activityname, .instancename, a.aalink, h3, h4, h5, .section-title').first();
            if (actualHeading.length > 0) {
              const clone = actualHeading.clone();
              clone.find('.accesshide, .sr-only').remove();
              const headingText = clone.text().trim();
              if (headingText && !genericFilters.includes(headingText.toLowerCase())) {
                name = headingText;
              }
            }
          }
        }

        name = name.replace(/Tarea$/, '').replace(/Cuestionario$/, '').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
        if (!name || name.length < 3) return;

        const lowerName = name.toLowerCase();
        const genericWords = [
          'continuar', 'continue', 'volver', 'regresar', 
          'siguiente', 'anterior', 'atras', 'cancelar', 
          'start', 'comenzar', 'intentar', 'iniciar', 'ir a',
          'ver', 'entrar', 'access', 'descargar', 'download',
          'click', 'clic', 'aquí', 'aqui'
        ];
        if (
          genericWords.some(gen => lowerName === gen || lowerName === `${gen}...` || lowerName === `...${gen}`) ||
          lowerName.includes('volver al') ||
          lowerName.includes('regresar al') ||
          lowerName.includes('ir al ') ||
          lowerName.includes('ir a la ') ||
          lowerName.includes('siguiente actividad') ||
          lowerName.includes('actividad anterior')
        ) {
          return;
        }

        let type = 'ACTIVIDAD';
        let icon = '📚';
        if (href.includes('/mod/assign/')) {
          type = 'TAREA';
          icon = '📝';
        } else if (href.includes('/mod/quiz/')) {
          type = 'CUESTIONARIO';
          icon = '📋';
        } else if (href.includes('/mod/forum/')) {
          type = 'FORO';
          icon = '💬';
        }

        const parentSection = page$(elem).closest('.section, li.section, .course-section');
        let sectionName = defaultSection;
        if (parentSection.length > 0) {
          const heading = parentSection.find('.sectionname, h2, h3, .section-title').first();
          if (heading.length > 0) {
            sectionName = heading.text().replace(/\s+/g, ' ').trim();
          }
        }

        let closure: string | null = null;
        let closureDateISO: string | null = null;

        const parentActivityElem = page$(elem).closest('.activity');
        if (parentActivityElem.length > 0) {
          const datesElem = parentActivityElem.find('.activitydates, .activity-dates, [data-region="activity-dates"], .activity-dates-wrapper, .activitymeta, .activityinfo, .activity-info');
          if (datesElem.length > 0) {
            const text = datesElem.text().trim();
            const parts = text.split('\n').map(p => p.trim()).filter(Boolean);
            for (const part of parts) {
              const lowerP = part.toLowerCase();
              if (lowerP.includes('cierra') || lowerP.includes('cierre') || lowerP.includes('vence') || lowerP.includes('entrega') || lowerP.includes('vencimiento') || lowerP.includes('due') || lowerP.includes('hasta')) {
                closure = part;
                const colonIdx = part.indexOf(':');
                const rawDate = colonIdx !== -1 ? part.substring(colonIdx + 1).trim() : part.replace(/cierra|cierre|vence|vencimiento|entrega|due|hasta/gi, '').trim();
                closureDateISO = parseMoodleSpanishDate(rawDate);
                break;
              }
            }
          }

          if (!closure) {
            parentActivityElem.find('div, p, span, small').each((_, el) => {
              const elText = page$(el).text().trim();
              if (!elText || elText.length > 100) return;
              const lowerT = elText.toLowerCase();
              if (lowerT.includes('cierra:') || lowerT.includes('cierre:') || lowerT.includes('vence:') || lowerT.includes('fecha de entrega:') || lowerT.includes('vencimiento:')) {
                closure = elText;
                const colonIdx = elText.indexOf(':');
                const rawDate = elText.substring(colonIdx + 1).trim();
                closureDateISO = parseMoodleSpanishDate(rawDate);
                return false;
              }
            });
          }
        }

        activitiesMap.set(fullUrl, {
          name,
          url: fullUrl,
          type,
          icon,
          section: sectionName,
          completionStatus: [],
          closure,
          closureDateISO
        });
      });
    };

    // Parse main page first
    parseAndRegisterActivities(courseHtml, 'General');

    // Fetch up to 35 sections in parallel to compile full agenda
    const limitUrls = sectionUrlsToFetch.slice(0, 35);
    
    await Promise.all(limitUrls.map(async (url) => {
      try {
        const secHtml = await fetchMoodleHtml(url, moodleSession);
        const secName = sectionNameByUrl[url] || 'Actividades';
        parseAndRegisterActivities(secHtml, secName);
      } catch (err) {
        console.warn(`Failed to fetch section page: ${url}`, err);
      }
    }));

    const activities = Array.from(activitiesMap.values());

    return res.json({ activities, sections });
  } catch (err: any) {
    const lowerMsg = (err.message || '').toLowerCase();
    const isSessionExpired = lowerMsg.includes('expiró') || lowerMsg.includes('expirada') || lowerMsg.includes('expirado') || lowerMsg.includes('inválida') || lowerMsg.includes('invalida') || lowerMsg.includes('sesión') || lowerMsg.includes('sesion') || lowerMsg.includes('redirect');
    if (isSessionExpired) {
      console.warn('Course activities expected session separation:', err.message);
      return res.status(401).json({ error: err.message });
    }
    console.error('Course activities error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// 4. API: Activity submission status, grades and details (scrapes assignments & quizzes)
app.post('/api/moodle/activity-details', async (req, res) => {
  const { moodleSession, server, activityUrl } = req.body;
  if (!moodleSession || !server || !activityUrl) {
    return res.status(400).json({ error: 'Falta sesión, servidor o URL de actividad' });
  }

  try {
    const activityHtml = await fetchMoodleHtml(activityUrl, moodleSession);
    const $ = cheerio.load(activityHtml);

    // 1. Precise DOM-based extraction for Moodle date wrapper blocks
    let domAperture: string | null = null;
    let domClosure: string | null = null;

    $('[data-region="activity-dates"], .rui-activity-dates, .activity-dates, .activity-dates-wrapper, .rui-activity-information').find('div, p, span').each((_, el) => {
      const text = $(el).text().trim();
      if (!text) return;
      const lower = text.toLowerCase();
      
      const isAp = lower.startsWith('abre:') || 
                   lower.startsWith('apertura:') || 
                   lower.startsWith('abrió:') || 
                   lower.startsWith('disponible desde:') ||
                   lower.startsWith('opened:');
                 
      const isCl = lower.startsWith('cierra:') || 
                   lower.startsWith('cierre:') || 
                   lower.startsWith('cerró:') || 
                   lower.startsWith('disponible hasta:') || 
                   lower.startsWith('fecha de entrega:') ||
                   lower.startsWith('closed:') ||
                   lower.startsWith('due:');

      if (isAp) {
        const val = text.substring(text.indexOf(':') + 1).trim();
        if (val && !domAperture) domAperture = val;
      } else if (isCl) {
        const val = text.substring(text.indexOf(':') + 1).trim();
        if (val && !domClosure) domClosure = val;
      }
    });

    // 2. Generate formatted pageText for fallback pattern matching
    const $clone = $('body').clone();
    $clone.find('div, p, br, h1, h2, h3, h4, h5, h6, li, tr, td, section, aside, header, footer').after('\n');
    const pageText = $clone.text() || $.text() || '';

    const dates = {
      aperture: domAperture as string | null,
      apertureDateISO: null as string | null,
      closure: domClosure as string | null,
      closureDateISO: null as string | null
    };

    // Fallback Extract Aperture via regex
    if (!dates.aperture) {
      const aperturePatterns = [
        /Apertura:\s*([^\n<]+)/i,
        /Apre:\s*([^\n<]+)/i,
        /Abrió:\s*([^\n<]+)/i,
        /Disponible desde:\s*([^\n<]+)/i,
        /Opened:\s*([^\n<]+)/i,
      ];
      for (const regex of aperturePatterns) {
        const m = pageText.match(regex);
        if (m && m[1]) {
          const val = m[1].trim();
          if (!val.includes('Cierre') && !val.includes('Cerró') && !val.includes('Cierra') && !val.includes('Disponible hasta')) {
            dates.aperture = val;
            break;
          }
        }
      }
    }

    // Fallback Extract Closure via regex
    if (!dates.closure) {
      const closurePatterns = [
        /Cierre:\s*([^\n<]+)/i,
        /Cierra:\s*([^\n<]+)/i,
        /Cerró:\s*([^\n<]+)/i,
        /Disponible hasta:\s*([^\n<]+)/i,
        /Fecha de entrega:\s*([^\n<]+)/i,
        /Closed:\s*([^\n<]+)/i,
        /Due:\s*([^\n<]+)/i,
      ];
      for (const regex of closurePatterns) {
        const m = pageText.match(regex);
        if (m && m[1]) {
          const val = m[1].trim();
          if (!val.includes('Apertura') && !val.includes('Abrió') && !val.includes('Abre') && !val.includes('Disponible desde')) {
            dates.closure = val;
            break;
          }
        }
      }
    }

    if (dates.closure) {
      dates.closureDateISO = parseMoodleSpanishDate(dates.closure);
    }
    if (dates.aperture) {
      dates.apertureDateISO = parseMoodleSpanishDate(dates.aperture);
    }

    // Determine type from URL
    const isAssign = activityUrl.includes('mod/assign');
    const isQuiz = activityUrl.includes('mod/quiz');
    const tipo_actividad = isAssign ? 'Tarea' : (isQuiz ? 'Cuestionario' : 'Actividad');

    const info: any = {
      aperture: dates.aperture,
      apertureDateISO: dates.apertureDateISO,
      closure: dates.closure,
      closureDateISO: dates.closureDateISO,
      tipo_actividad,
      requisitos_pendientes: [] as string[],
      requisitos_completados: [] as string[],
      archivos_enviados: [],
      archivos_adicionales: [],
      detalle: null,
      quiz_info: null
    };

    // Extract badges requirements
    $('.badge-sm, .badge').each((_, badge) => {
      const badgeText = $(badge).text().trim();
      if (badgeText.startsWith('Hecho:')) {
        info.requisitos_completados.push(badgeText.replace('Hecho:', '').trim());
      } else if (badgeText.startsWith('Por hacer:')) {
        info.requisitos_pendientes.push(badgeText.replace('Por hacer:', '').trim());
      }
    });

    // 1. TAREA SPECIFIC DETAILS
    if (isAssign) {
      const submissionTable = $('.submissionsummarytable, .submissionstatustable, table:contains("Estado de la entrega")').first();
      const tableDetails: Record<string, string> = {};

      if (submissionTable.length > 0) {
        submissionTable.find('tr').each((_, tr) => {
          const th = $(tr).find('th, td.cell.c0').first().text().trim().toLowerCase();
          const td = $(tr).find('td, td.cell.c1').last().text().trim();
          if (th && td && td !== '-') {
            tableDetails[th] = td;
          }
        });
      }

      info.grupo = tableDetails['grupo'] || tableDetails['group'] || null;
      info.intento = tableDetails['número del intento'] || tableDetails['intento'] || null;
      info.estado_entrega = tableDetails['estado de la entrega'] || tableDetails['submission status'] || null;
      info.estado_calificacion = tableDetails['estado de la calificación'] || tableDetails['grading status'] || null;
      info.tiempo_restante = tableDetails['tiempo restante'] || tableDetails['time remaining'] || null;
      info.ultima_modificacion = tableDetails['última modificación'] || tableDetails['last modified'] || null;

      // Extract files sent
      if (submissionTable.length > 0) {
        submissionTable.find('tr').each((_, tr) => {
          const thText = $(tr).find('th, td.cell.c0').first().text().trim().toLowerCase();
          if (thText.includes('archivos enviados') || thText.includes('file submissions')) {
            $(tr).find('a[href]').each((_, a) => {
              const url = $(a).attr('href') || '';
              const nombre = $(a).text().trim();
              if (nombre && url) {
                info.archivos_enviados.push({ nombre, url });
              }
            });
          }
        });
      }

      // Grade feedback
      const gradeTable = $('.feedback table.generaltable, .feedbacktable table');
      if (gradeTable.length > 0) {
        gradeTable.find('tr').each((_, tr) => {
          const th = $(tr).find('th').first().text().trim().toLowerCase();
          const td = $(tr).find('td').last().text().trim();
          if (th && td) {
            if (th.includes('calificación') || th.includes('grade')) {
              const m = td.match(/(\d+[.,]?\d*)\s*[/]\s*(\d+[.,]?\d*)/);
              if (m) {
                info.calificacion = m[1];
                info.calificacion_sobre = m[2];
              } else {
                info.calificacion = td;
              }
            } else if (th.includes('fecha') || th.includes('date')) {
              info.fecha_calificacion = td;
            } else if (th.includes('calificado por') || th.includes('graded by')) {
              info.calificado_por = $(tr).find('td a').first().text().trim() || td;
            }
          }
        });
      }

      const commentElem = $('.feedback .comment, .feedbacktable, .feedback .no-overflow');
      if (commentElem.length > 0) {
        info.comentario_calificador = commentElem.text().trim().replace(/^Comentarios?/i, '').trim();
      }
    }

    // 2. QUIZ SPECIFIC DETAILS
    if (isQuiz) {
      const quiz_info: any = {
        intentos_permitidos: null,
        limite_tiempo: null,
        calificacion_final: null,
        calificacion_sobre: null,
        porcentaje: null,
        intentos: []
      };

      const matchIntentos = pageText.match(/Intentos permitidos:\s*(\d+)/i) || pageText.match(/Attempts allowed:\s*(\d+)/i);
      if (matchIntentos) quiz_info.intentos_permitidos = matchIntentos[1];

      const matchTiempo = pageText.match(/Límite de tiempo:\s*([^\n<]+)/i) || pageText.match(/Time limit:\s*([^\n<]+)/i);
      if (matchTiempo) quiz_info.limite_tiempo = matchTiempo[1].trim();

      const feedbackDiv = $('#feedback, .quizfeedback');
      if (feedbackDiv.length > 0) {
        const fbText = feedbackDiv.text().trim();
        const matchFinalGrade = fbText.match(/calificación final.*?(\d+[.,]?\d*)\s*[/]\s*(\d+[.,]?\d*)/i);
        if (matchFinalGrade) {
          quiz_info.calificacion_final = matchFinalGrade[1];
          quiz_info.calificacion_sobre = matchFinalGrade[2];
        }
        const matchPct = fbText.match(/\((\d+)%\)/);
        if (matchPct) quiz_info.porcentaje = matchPct[1];
      }

      // Quiz attempts summary
      $('.rui-attempts-list, table.quizattemptsummary').each((_, summary) => {
        $(summary).find('tr, .rounded.border').each((_, container) => {
          const $container = $(container);
          const attempt: any = {
            numero: null,
            estado: null,
            comenzado: null,
            completado: null,
            duracion: null,
            calificacion: null,
            calificacion_sobre: null,
            porcentaje: null,
            revision_url: null,
            revision_permitida: false
          };

          const h4Val = $container.find('h4, td.c0, th').first().text().trim();
          const matchNum = h4Val.match(/Intento\s*(\d+)/i) || h4Val.match(/Attempt\s*(\d+)/i) || h4Val.match(/^(\d+)$/);
          if (matchNum) attempt.numero = matchNum[1];

          if ($container.hasClass('rounded')) {
            $container.find('.rui-infobox').each((_, box) => {
              const title = $(box).find('h5').text().trim().toLowerCase();
              const value = $(box).find('.rui-infobox-content--small').text().trim();
              if (title.includes('estado')) {
                attempt.estado = value;
              } else if (title.includes('comenzado')) {
                attempt.comenzado = value;
              } else if (title.includes('completo')) {
                attempt.completado = value;
              } else if (title.includes('duración')) {
                attempt.duracion = value;
              } else if (title.includes('calificación')) {
                const m = value.match(/(\d+[.,]?\d*)\s+de\s+(\d+[.,]?\d*)\s*\((\d+)%\)/);
                if (m) {
                  attempt.calificacion = m[1];
                  attempt.calificacion_sobre = m[2];
                  attempt.porcentaje = m[3];
                } else {
                  const mSimple = value.match(/(\d+[.,]?\d*)/);
                  if (mSimple) attempt.calificacion = mSimple[1];
                }
              }
            });
          } else {
            const stateText = $container.find('.state, td.c1').first().text().trim();
            if (stateText) attempt.estado = stateText;
            const gradeText = $container.find('.grade, td.c2').first().text().trim();
            if (gradeText) attempt.calificacion = gradeText;
          }

          const revLink = $container.find('a[href*="review.php"]');
          if (revLink.length > 0) {
            attempt.revision_url = revLink.attr('href');
            attempt.revision_permitida = true;
          }

          if (attempt.numero || attempt.estado) {
            quiz_info.intentos.push(attempt);
          }
        });
      });

      info.quiz_info = quiz_info;
    }

    // 3. DESCRIPTION / DETAILS UTILS
    const descriptionDiv = $('.activity-description, #intro, .activity-header');
    if (descriptionDiv.length > 0) {
      info.detalle = descriptionDiv.text().trim();

      // Additional files
      descriptionDiv.find('a[href]').each((_, link) => {
        const href = $(link).attr('href') || '';
        const texto = $(link).text().trim();
        if (href && texto && texto.length > 3) {
          if (href.includes('pluginfile') || href.endsWith('.pdf') || href.endsWith('.docx') || href.endsWith('.doc')) {
            info.archivos_adicionales.push({ texto, url: href });
          }
        }
      });
    }

    if (!info.detalle && pageText) {
      // Find backup block or short text snippet
      const contentSnippet = pageText.split('Apertura:')[0]?.split('Límite de tiempo:')[0]?.substring(0, 400)?.trim();
      if (contentSnippet && contentSnippet.length > 20) {
        info.detalle = contentSnippet;
      }
    }

    // Capture "Aún no se han agregado preguntas" alert or direct text
    let advertencia_preguntas = null;
    if (pageText.includes('Aún no se han agregado preguntas') || activityHtml.includes('Aún no se han agregado preguntas')) {
      advertencia_preguntas = 'Aún no se han agregado preguntas';
    }
    info.advertencia_preguntas = advertencia_preguntas;

    // Capture completion badge indicating "Por hacer: Recibir una calificación"
    let por_hacer_calificacion = false;
    if (Array.isArray(info.requisitos_pendientes)) {
      por_hacer_calificacion = info.requisitos_pendientes.some((req: string) => 
        req.toLowerCase().includes('recibir una calificación') || 
        req.toLowerCase().includes('recibir una calificacion')
      );
    }
    if (!por_hacer_calificacion) {
      const lowerPage = pageText.toLowerCase();
      por_hacer_calificacion = lowerPage.includes('por hacer: recibir una calificación') || lowerPage.includes('por hacer: recibir una calificacion');
    }
    info.por_hacer_calificacion = por_hacer_calificacion;

    // Capture completion badge indicating "Hecho: Recibir una calificación"
    let hecho_calificacion = false;
    if (Array.isArray(info.requisitos_completados)) {
      hecho_calificacion = info.requisitos_completados.some((req: string) => 
        req.toLowerCase().includes('recibir una calificación') || 
        req.toLowerCase().includes('recibir una calificacion')
      );
    }
    if (!hecho_calificacion) {
      const lowerPage = pageText.toLowerCase();
      hecho_calificacion = lowerPage.includes('hecho: recibir una calificación') || lowerPage.includes('hecho: recibir una calificacion');
    }
    info.hecho_calificacion = hecho_calificacion;

    return res.json({ details: info });
  } catch (err: any) {
    const lowerMsg = (err.message || '').toLowerCase();
    const isSessionExpired = lowerMsg.includes('expiró') || lowerMsg.includes('expirada') || lowerMsg.includes('expirado') || lowerMsg.includes('inválida') || lowerMsg.includes('invalida') || lowerMsg.includes('sesión') || lowerMsg.includes('sesion') || lowerMsg.includes('redirect');
    if (isSessionExpired) {
      console.warn('Activity details expected session separation:', err.message);
      return res.status(401).json({ error: err.message });
    }
    console.error('Activity details error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// 5. API: Download raw HTML of any Moodle activity url
app.post('/api/moodle/download-raw', async (req, res) => {
  const { moodleSession, server, url } = req.body;
  if (!moodleSession || !server || !url) {
    return res.status(400).json({ error: 'Falta sesión, servidor o URL' });
  }

  try {
    const html = await fetchMoodleHtml(url, moodleSession);
    return res.json({ html });
  } catch (err: any) {
    const lowerMsg = (err.message || '').toLowerCase();
    const isSessionExpired = lowerMsg.includes('expiró') || lowerMsg.includes('expirada') || lowerMsg.includes('expirado') || lowerMsg.includes('inválida') || lowerMsg.includes('invalida') || lowerMsg.includes('sesión') || lowerMsg.includes('sesion') || lowerMsg.includes('redirect');
    if (isSessionExpired) {
      console.warn('Download raw expected session separation:', err.message);
      return res.status(401).json({ error: err.message });
    }
    console.error('Download raw error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// --- SERVER-SIDE RESUMABLE BACKGROUND SYNC SYSTEM ---
const DATA_DIR = path.join(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

interface SyncLogEntry {
  timestamp: string;
  type: 'info' | 'success' | 'warn' | 'error' | 'performance';
  message: string;
  durationMs?: number;
}

interface SyncJob {
  key: string;
  status: 'idle' | 'syncing' | 'completed' | 'failed' | 'paused' | 'interrupted';
  currentCourse: string;
  currentActivity: string;
  processedCount: number;
  totalCount: number;
  tasks: any[];
  error?: string;
  lastActive: number;
  logs?: SyncLogEntry[];
  expiredSessions?: { username: string; server: 'a' | 'b' }[];
}

const syncJobs = new Map<string, SyncJob>();

function addLog(job: SyncJob, type: 'info' | 'success' | 'warn' | 'error' | 'performance', message: string, durationMs?: number) {
  if (!job.logs) job.logs = [];
  const now = new Date();
  const timestamp = now.toTimeString().split(' ')[0] + '.' + String(now.getMilliseconds()).padStart(3, '0');
  job.logs.push({ timestamp, type, message, durationMs });
  console.log(`[SyncLog][${timestamp}] [${type.toUpperCase()}] ${message} ${durationMs !== undefined ? `(${durationMs}ms)` : ''}`);
}

async function saveJobToDisk(key: string, job: SyncJob) {
  try {
    const filePath = path.join(DATA_DIR, `sync_${key}.json`);
    await fs.promises.writeFile(filePath, JSON.stringify(job, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to write job to disk:', err);
  }
}

async function loadJobFromDisk(key: string): Promise<SyncJob | null> {
  try {
    const filePath = path.join(DATA_DIR, `sync_${key}.json`);
    if (fs.existsSync(filePath)) {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      return JSON.parse(content);
    }
  } catch (err) {
    // If file doesn't exist, ignore logs to keep cleanly separated
  }
  return null;
}

async function processQueueConcurrently(
  queue: any[],
  concurrencyLimit: number,
  workerFn: (item: any) => Promise<void>
) {
  const activePromises: Promise<void>[] = [];
  for (const item of queue) {
    if (activePromises.length >= concurrencyLimit) {
      await Promise.race(activePromises);
    }
    const p = workerFn(item).then(() => {
      activePromises.splice(activePromises.indexOf(p), 1);
    });
    activePromises.push(p);
  }
  await Promise.all(activePromises);
}

async function runBackgroundSync(key: string, sessions: any[]) {
  const job = syncJobs.get(key);
  if (!job) return;

  try {
    const baseUrls = sessions.map(s => s.server === 'a' ? 'https://aulagradoa.unemi.edu.ec' : 'https://aulagradob.unemi.edu.ec');
    
    // Step 1: Map all courses for each active session
    job.currentCourse = 'Verificando sesiones...';
    job.currentActivity = `Validando conexiones de Moodle para ${sessions.length} cuenta(s)...`;
    await saveJobToDisk(key, job);

    const coursesBySession: { sessIdx: number; courses: any[] }[] = [];
    let validSessionCount = 0;
    const invalidSessions: string[] = [];
    job.expiredSessions = [];

    addLog(job, 'info', `Verificando conexiones en Moodle para ${sessions.length} cuenta(s) activa(s)...`);

    for (let sIdx = 0; sIdx < sessions.length; sIdx++) {
      const sess = sessions[sIdx];
      const base = baseUrls[sIdx];
      const startDash = Date.now();
      try {
        const dashboardHtml = await fetchMoodleHtml(`${base}/my/`, sess.cookies);
        const dashTime = Date.now() - startDash;
        validSessionCount++;
        const $ = cheerio.load(dashboardHtml);
        const courses: any[] = [];
        
        $('a[href]').each((_, elem) => {
          const text = $(elem).text().trim();
          const href = $(elem).attr('href') || '';
          const isMoodleFormat = /\s*-\s*\[[^\]]+\]\s*-\s*/.test(text);
          const isCourseUrl = href.includes('course/view.php');
          if ((isMoodleFormat || (isCourseUrl && text.length > 6)) && !text.includes('Área personal') && !text.includes('Dashboard')) {
            const fullUrl = href.startsWith('http') ? href : new URL(href, base).toString();
            const idMatch = href.match(/id=(\d+)/);
            const id = idMatch ? idMatch[1] : href;
            if (!courses.some(c => c.id === id)) {
              courses.push({ id, text, url: fullUrl });
            }
          }
        });
        
        coursesBySession.push({ sessIdx: sIdx, courses });
        addLog(job, 'performance', `[HTTP_GET] URL="${base}/my/" | RESPONSE=200 OK | PAYLOAD_SIZE=${dashboardHtml.length} bytes | PARSER="cheerio" | EXTRACTED_COURSES=${courses.length} | USER="${sess.username}" | AUTH_COOKIES_LEN=${sess.cookies ? sess.cookies.length : 0} bytes`, dashTime);
      } catch (e: any) {
        const dashTime = Date.now() - startDash;
        const lowerMsg = (e.message || '').toLowerCase();
        const isSessionExpired = lowerMsg.includes('expiró') || lowerMsg.includes('expirada') || lowerMsg.includes('expirado') || lowerMsg.includes('inválida') || lowerMsg.includes('invalida') || lowerMsg.includes('sesión') || lowerMsg.includes('sesion');
        
        const label = `${sess.username} (${sess.server === 'a' ? 'Aula Grado A' : 'Aula Grado B'})`;
        if (!job.expiredSessions) job.expiredSessions = [];
        job.expiredSessions.push({ username: sess.username, server: sess.server });
        
        addLog(job, 'warn', `[HTTP_GET_FAIL] URL="${base}/my/" | ERROR="${e.message}" | STACK="${e.stack ? e.stack.split('\n')[0] : 'N/A'}" | CONFIG_SERVER="${sess.server.toUpperCase()}" | USER="${sess.username}"`, dashTime);
        if (isSessionExpired) {
          console.warn(`[Expected Expiry] Background course list download for ${sess.username} had expired session.`);
        } else {
          console.error(`Background course list download failed for ${sess.username}:`, e);
        }
        invalidSessions.push(label);
      }
    }

    if (validSessionCount === 0) {
      addLog(job, 'error', `[SYNC_ABORT] CRITICAL_ERROR="Zero active sessions matched" | ATOMS_CHECKED=${sessions.length} | EXPIRED_ACCOUNTS="${invalidSessions.join(', ')}"`);
      throw new Error(`No hay sesiones abiertas actualmente. Las cuentas conectadas (${invalidSessions.join(', ')}) han expirado o se cerraron. Por favor ingresa tus datos de acceso nuevamente en 'Conectar Moodle'.`);
    }

    job.currentCourse = 'Sesiones verificadas';
    job.currentActivity = `Encontradas ${validSessionCount} de ${sessions.length} sesiones abiertas. Iniciando sincronización...`;
    addLog(job, 'success', `[VALIDATE_SESSIONS] STATUS_SUCCESS=true | ACTIVE_SESSIONS_COUNT=${validSessionCount} | INACTIVE_SESSIONS_COUNT=${sessions.length - validSessionCount}`);
    await saveJobToDisk(key, job);

    // Step 2: Extract all core courses activities
    const workingQueue: any[] = [];
    for (const coursesObj of coursesBySession) {
      const sess = sessions[coursesObj.sessIdx];
      const base = baseUrls[coursesObj.sessIdx];
      for (const course of coursesObj.courses) {
        // Double check status before doing heavy scans to allow cleaner cancellations
        const currJob = syncJobs.get(key);
        if (!currJob || currJob.status === 'idle') {
          return;
        }

        job.currentCourse = `${sess.username}: ${course.text}`;
        job.currentActivity = 'Buscando tareas y cuestionarios...';
        await saveJobToDisk(key, job);

        const courseStart = Date.now();
        try {
          const fetchStart = Date.now();
          const courseHtml = await fetchMoodleHtml(course.url, sess.cookies);
          const fetchTime = Date.now() - fetchStart;
          const $ = cheerio.load(courseHtml);
          const courseIdMatch = course.url.match(/id=(\d+)/);
          const courseId = courseIdMatch ? courseIdMatch[1] : '';

          const sectionUrlsToFetch: string[] = [];
          const sections: any[] = [];

          const addSectionUrl = (urlStr: string, nameText: string) => {
            if (!urlStr) return;
            const fullUrl = urlStr.startsWith('http') ? urlStr : new URL(urlStr, base).toString();
            if (courseId && (!fullUrl.includes('id=' + courseId) || (!fullUrl.includes('section=') && !fullUrl.includes('sectionid=')))) return;
            const cleanName = nameText.replace(/Tema\s+\d+/gi, '').replace(/Sección\s+\d+/gi, '').replace(/Unidad\s+\d+/gi, '').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim() || nameText.trim();
            if (!sections.some(s => s.url === fullUrl)) {
              sections.push({ text: cleanName || nameText.trim() || 'Sección', url: fullUrl });
            }
            if (!sectionUrlsToFetch.includes(fullUrl)) {
              sectionUrlsToFetch.push(fullUrl);
            }
          };

          $('.section').each((_, elem) => {
            const sectionNameElem = $(elem).find('.sectionname, h2, h3, .section-title').first();
            const text = sectionNameElem.text().trim();
            const hrefLink = $(elem).find('a[href]').first();
            const href = hrefLink.attr('href') || '';
            if (href) addSectionUrl(href, text);
          });

          $('[id^="section-"]').each((_, elem) => {
            const idStr = $(elem).attr('id') || '';
            const match = idStr.match(/^section-(\d+)$/);
            if (match && match[1] !== '0') {
              const heading = $(elem).find('.sectionname, h2, h3, .section-title').first().text().trim();
              addSectionUrl(`${course.url}&section=${match[1]}`, heading || `Sección ${match[1]}`);
            }
          });

          $('a[href]').each((_, elem) => {
            const href = $(elem).attr('href') || '';
            const text = $(elem).text().trim();
            if (href.includes('course/view.php') && (href.includes('section=') || href.includes('sectionid='))) {
              const idMatch = href.match(/id=(\d+)/);
              if (!courseId || (idMatch && idMatch[1] === courseId)) {
                addSectionUrl(href, text || `Sección`);
              }
            }
          });

          if (sections.length === 0 && courseId) {
            for (let i = 1; i <= 8; i++) {
              addSectionUrl(`${course.url}&section=${i}`, `Sección ${i}`);
            }
          }

          const activitiesMap = new Map<string, any>();
          const sectionNameByUrl: Record<string, string> = {};
          sections.forEach(s => { sectionNameByUrl[s.url] = s.text; });

          const parseAndRegisterActivities = (html: string, defaultSection: string) => {
            const page$ = cheerio.load(html);
            page$('.activity').each((_, elem) => {
              const $activity = page$(elem);
              let link = $activity.find('a.aalink').first();
              if (link.length === 0) link = $activity.find('a[href]').first();
              if (link.length === 0) return;
              const url = link.attr('href') || '';
              if (!url || url.includes('course/view.php')) return;
              const fullUrl = url.startsWith('http') ? url : new URL(url, base).toString();
              
              let name = '';
              const instancename = link.find('.instancename').first();
              if (instancename.length > 0) {
                const clone = instancename.clone();
                clone.find('.accesshide').remove();
                name = clone.text().trim();
              } else {
                name = link.text().trim() || $activity.text().trim();
              }

              const testLower = name.trim().toLowerCase();
              const genericFilters = ['continuar', 'continue', 'intentar', 'iniciar', 'ver', 'entrar', 'comenzar', 'continuar el último intento'];
              if (!name || name.length < 2 || genericFilters.includes(testLower)) {
                const actualHeading = $activity.find('.activityname, .instancename, a.aalink, h3, h4, h5, .section-title').first();
                if (actualHeading.length > 0) {
                  const clone = actualHeading.clone();
                  clone.find('.accesshide, .sr-only').remove();
                  const headingText = clone.text().trim();
                  if (headingText && !genericFilters.includes(headingText.toLowerCase())) {
                    name = headingText;
                  }
                }
              }

              name = name.replace(/Tarea$/, '').replace(/Cuestionario$/, '').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
              if (!name || name.length < 2) return;

              const lowerName = name.toLowerCase();
              const genericWords = [
                'continuar', 'continue', 'volver', 'regresar', 
                'siguiente', 'anterior', 'atras', 'cancelar', 
                'start', 'comenzar', 'intentar', 'iniciar', 'ir a',
                'ver', 'entrar', 'access', 'descargar', 'download',
                'click', 'clic', 'aquí', 'aqui'
              ];
              if (
                genericWords.some(gen => lowerName === gen || lowerName === `${gen}...` || lowerName === `...${gen}`) ||
                lowerName.includes('volver al') || lowerName.includes('regresar al') ||
                lowerName.includes('ir al ') || lowerName.includes('ir a la ') ||
                lowerName.includes('siguiente actividad') || lowerName.includes('actividad anterior')
              ) {
                return;
              }

              let type = 'ACTIVIDAD';
              let icon = '📚';
              if ($activity.hasClass('assign') || url.includes('/mod/assign/')) {
                type = 'TAREA';
                icon = '📝';
              } else if ($activity.hasClass('quiz') || url.includes('/mod/quiz/')) {
                type = 'CUESTIONARIO';
                icon = '📋';
              } else if ($activity.hasClass('forum') || url.includes('/mod/forum/')) {
                type = 'FORO';
                icon = '💬';
              }

              const completionStatus: string[] = [];
              $activity.find('.badge, span[class*="badge"], .completioninfo, .completion-info').each((_, badgeElem) => {
                const badgeText = page$(badgeElem).text().trim();
                if (badgeText) completionStatus.push(badgeText);
              });

              let sectionName = defaultSection;
              const parentSection = $activity.closest('.section, li.section, .course-section');
              if (parentSection.length > 0) {
                const heading = parentSection.find('.sectionname, h2, h3, .section-title').first();
                if (heading.length > 0) sectionName = heading.text().replace(/\s+/g, ' ').trim();
              }

              let closure: string | null = null;
              let closureDateISO: string | null = null;
              const datesElem = $activity.find('.activitydates, .activity-dates, [data-region="activity-dates"], .activity-dates-wrapper, .activitymeta, .activityinfo, .activity-info');
              if (datesElem.length > 0) {
                const text = datesElem.text().trim();
                const parts = text.split('\n').map(p => p.trim()).filter(Boolean);
                for (const part of parts) {
                  const lowerP = part.toLowerCase();
                  if (lowerP.includes('cierra') || lowerP.includes('cierre') || lowerP.includes('vence') || lowerP.includes('entrega') || lowerP.includes('vencimiento') || lowerP.includes('due') || lowerP.includes('hasta')) {
                    closure = part;
                    const colonIdx = part.indexOf(':');
                    const rawDate = colonIdx !== -1 ? part.substring(colonIdx + 1).trim() : part.replace(/cierra|cierre|vence|vencimiento|entrega|due|hasta/gi, '').trim();
                    closureDateISO = parseMoodleSpanishDate(rawDate);
                    break;
                  }
                }
              }

              if (!closure) {
                $activity.find('div, p, span, small').each((_, el) => {
                  const elText = page$(el).text().trim();
                  if (!elText || elText.length > 100) return;
                  const lowerT = elText.toLowerCase();
                  if (lowerT.includes('cierra:') || lowerT.includes('cierre:') || lowerT.includes('vence:') || lowerT.includes('fecha de entrega:') || lowerT.includes('vencimiento:')) {
                    closure = elText;
                    const colonIdx = elText.indexOf(':');
                    const rawDate = elText.substring(colonIdx + 1).trim();
                    closureDateISO = parseMoodleSpanishDate(rawDate);
                    return false;
                  }
                });
              }

              if (!activitiesMap.has(fullUrl)) {
                activitiesMap.set(fullUrl, {
                  name,
                  url: fullUrl,
                  type,
                  icon,
                  section: sectionName,
                  completionStatus,
                  closure,
                  closureDateISO
                });
              }
            });

            // Extra support for general anchor links inside Sections
            page$('a[href]').each((_, elem) => {
              const href = page$(elem).attr('href') || '';
              if (!href.includes('/mod/assign/') && !href.includes('/mod/quiz/') && !href.includes('/mod/forum/')) return;
              const fullUrl = href.startsWith('http') ? href : new URL(href, base).toString();
              if (activitiesMap.has(fullUrl)) return;

              let name = page$(elem).text().trim();
              const instancename = page$(elem).find('.instancename').first();
              if (instancename.length > 0) {
                const clone = instancename.clone();
                clone.find('.accesshide').remove();
                name = clone.text().trim();
              }

              const testLower = name.trim().toLowerCase();
              const genericFilters = ['continuar', 'continue', 'intentar', 'iniciar', 'ver', 'entrar', 'comenzar', 'continuar el último intento'];
              if (!name || name.length < 2 || genericFilters.includes(testLower)) {
                const parentActivity = page$(elem).closest('.activity');
                if (parentActivity.length > 0) {
                  const actualHeading = parentActivity.find('.activityname, .instancename, a.aalink, h3, h4, h5, .section-title').first();
                  if (actualHeading.length > 0) {
                    const clone = actualHeading.clone();
                    clone.find('.accesshide, .sr-only').remove();
                    const headingText = clone.text().trim();
                    if (headingText && !genericFilters.includes(headingText.toLowerCase())) {
                      name = headingText;
                    }
                  }
                }
              }

              name = name.replace(/Tarea$/, '').replace(/Cuestionario$/, '').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
              if (!name || name.length < 3) return;

              const lowerName = name.toLowerCase();
              const genericWords = [
                'continuar', 'continue', 'volver', 'regresar', 
                'siguiente', 'anterior', 'atras', 'cancelar', 
                'start', 'comenzar', 'intentar', 'iniciar', 'ir a',
                'ver', 'entrar', 'access', 'descargar', 'download',
                'click', 'clic', 'aquí', 'aqui'
              ];
              if (
                genericWords.some(gen => lowerName === gen || lowerName === `${gen}...` || lowerName === `...${gen}`) ||
                lowerName.includes('volver al') || lowerName.includes('regresar al') ||
                lowerName.includes('ir al ') || lowerName.includes('ir a la ') ||
                lowerName.includes('siguiente actividad') || lowerName.includes('actividad anterior')
              ) {
                return;
              }

              let type = 'ACTIVIDAD';
              let icon = '📚';
              if (href.includes('/mod/assign/')) { type = 'TAREA'; icon = '📝'; }
              else if (href.includes('/mod/quiz/')) { type = 'CUESTIONARIO'; icon = '📋'; }
              else if (href.includes('/mod/forum/')) { type = 'FORO'; icon = '💬'; }

              let sectionName = defaultSection;
              const parentSection = page$(elem).closest('.section, li.section, .course-section');
              if (parentSection.length > 0) {
                const heading = parentSection.find('.sectionname, h2, h3, .section-title').first();
                if (heading.length > 0) sectionName = heading.text().replace(/\s+/g, ' ').trim();
              }

              let closure: string | null = null;
              let closureDateISO: string | null = null;
              const parentActivityElem = page$(elem).closest('.activity');
              if (parentActivityElem.length > 0) {
                const datesElem = parentActivityElem.find('.activitydates, .activity-dates, [data-region="activity-dates"], .activity-dates-wrapper, .activitymeta, .activityinfo, .activity-info');
                if (datesElem.length > 0) {
                  const text = datesElem.text().trim();
                  const parts = text.split('\n').map(p => p.trim()).filter(Boolean);
                  for (const part of parts) {
                    const lowerP = part.toLowerCase();
                    if (lowerP.includes('cierra') || lowerP.includes('cierre') || lowerP.includes('vence') || lowerP.includes('entrega') || lowerP.includes('vencimiento') || lowerP.includes('due') || lowerP.includes('hasta')) {
                      closure = part;
                      const colonIdx = part.indexOf(':');
                      const rawDate = colonIdx !== -1 ? part.substring(colonIdx + 1).trim() : part.replace(/cierra|cierre|vence|vencimiento|entrega|due|hasta/gi, '').trim();
                      closureDateISO = parseMoodleSpanishDate(rawDate);
                      break;
                    }
                  }
                }
              }

              activitiesMap.set(fullUrl, {
                name,
                url: fullUrl,
                type,
                icon,
                section: sectionName,
                completionStatus: [],
                closure,
                closureDateISO
              });
            });
          };

          parseAndRegisterActivities(courseHtml, 'General');

          // Support parallel sections crawl on server for high velocity
          const limitUrls = sectionUrlsToFetch.slice(0, 35);
          const sectionsStart = Date.now();
          if (limitUrls.length > 0) {
            await Promise.all(limitUrls.map(async (url) => {
              try {
                const secHtml = await fetchMoodleHtml(url, sess.cookies);
                const secName = sectionNameByUrl[url] || 'Actividades';
                parseAndRegisterActivities(secHtml, secName);
              } catch (err) {
                // Ignore failing sections gracefully
              }
            }));
            const sectionsDuration = Date.now() - sectionsStart;
            addLog(job, 'performance', `[PARALLEL_SECTIONS_FETCH] COURSE_ID=${course.id} | ATTEMPTED_SECTIONS=${limitUrls.length} | SUBTOPICS_RESOLVED=${limitUrls.length} | CONCURRENCY_MAX=35 | DELAY=${sectionsDuration}ms | TEXT="${course.text}"`, sectionsDuration);
          }

          const activities = Array.from(activitiesMap.values());
          const actionable = activities.filter((act: any) => act.type === 'TAREA' || act.type === 'CUESTIONARIO');
          
          actionable.forEach((act: any) => {
            workingQueue.push({
              sessionIndex: coursesObj.sessIdx,
              username: sess.username,
              server: sess.server,
              courseId: course.id,
              courseName: course.text,
              activityUrl: act.url,
              type: act.type,
              activityName: act.name
            });
          });

          const totalDuration = Date.now() - courseStart;
          addLog(job, 'performance', `[COURSE_RESOLVED] COURSE_ID=${course.id} | TITLE="${course.text}" | HTML_SIZE=${courseHtml ? courseHtml.length : 0} bytes | FETCH_DNS_TCP_DUR=${fetchTime}ms | SECTIONS_EXPLORED=${sectionUrlsToFetch.length} | TOTAL_ACTIVITIES_DISCOVERED=${activities.length} | ACTIONABLE_DELIVERABLES=${actionable.length} | TOTAL_SCRAPE_DUR=${totalDuration}ms`, totalDuration);
        } catch (e: any) {
          const totalDuration = Date.now() - courseStart;
          addLog(job, 'warn', `[COURSE_SCRAPE_FAIL] COURSE_ID=${course.id} | NAME="${course.text}" | ERROR_MSG="${e.message}" | TOTAL_DUR=${totalDuration}ms | STACK="${e.stack ? e.stack.split('\n')[0] : 'N/A'}"`, totalDuration);
          const lowerMsg = (e.message || '').toLowerCase();
          const isSessionExpired = lowerMsg.includes('expiró') || lowerMsg.includes('expirada') || lowerMsg.includes('expirado') || lowerMsg.includes('inválida') || lowerMsg.includes('invalida') || lowerMsg.includes('sesión') || lowerMsg.includes('sesion');
          if (isSessionExpired) {
            console.warn(`[Expected Expiry] Scrape course activities for ${sess.username} - ${course.text} had expired session.`);
          } else {
            console.error(`Scrape course activities failed for ${sess.username} - ${course.text}:`, e);
          }
        }
      }
    }

    // Prepare active queue details
    job.totalCount = workingQueue.length;
    job.processedCount = 0;
    job.tasks = [];
    await saveJobToDisk(key, job);

    if (workingQueue.length === 0) {
      job.status = 'completed';
      await saveJobToDisk(key, job);
      return;
    }

    const isStatusSubmittedServer = (estadoEntrega: string | null | undefined): boolean => {
      if (!estadoEntrega) return false;
      const estLower = estadoEntrega.toLowerCase();
      if (
        estLower.includes('no se ha enviado nada') || 
        estLower.includes('no entregado') || 
        estLower.includes('sin entregar') || 
        estLower.includes('no enviado') ||
        estLower.includes('sin enviar')
      ) {
        return false;
      }
      if (estLower.includes('enviado') || estLower.includes('entregado')) {
        return true;
      }
      return false;
    };

    // Server-side equivalents helper for stats and task modeling
    const computeStatsServer = (type: string, details: any) => {
      let status = 'No entregado';
      let grade: string | null = null;
      let gradeOver: string | null = null;

      if (details.por_hacer_calificacion) {
        return { status: 'No entregado', grade: null, gradeOver: null };
      }

      if (type === 'CUESTIONARIO') {
        if (details.quiz_info) {
          const qi = details.quiz_info;
          if (qi.calificacion_final) {
            status = 'Calificado';
            grade = qi.calificacion_final;
            gradeOver = qi.calificacion_sobre;
          } else if (qi.intentos && qi.intentos.length > 0) {
            const finishedAttempt = qi.intentos.find((att: any) => 
              att.estado?.toLowerCase().includes('terminado') || 
              att.estado?.toLowerCase().includes('finalizado')
            );
            if (finishedAttempt) {
              status = finishedAttempt.calificacion ? 'Calificado' : 'Entregado';
              grade = finishedAttempt.calificacion;
              gradeOver = finishedAttempt.calificacion_sobre;
            } else {
              status = 'Entregado';
            }
          } else if (details.hecho_calificacion) {
            status = 'Entregado';
          }
        } else if (details.hecho_calificacion) {
          status = 'Entregado';
        }
      } else if (type === 'TAREA') {
        const isCalificado = details.estado_calificacion?.toLowerCase().includes('calificado') || !!details.calificacion;
        if (isCalificado) {
          status = 'Calificado';
          grade = details.calificacion || null;
          gradeOver = details.calificacion_sobre || null;
        } else if (isStatusSubmittedServer(details.estado_entrega)) {
          status = 'Entregado';
        } else {
          const estEntrega = details.estado_entrega?.toLowerCase() || '';
          if (estEntrega.includes('borrador')) {
            status = 'Borrador';
          } else if (estEntrega.includes('no entregado') || estEntrega.includes('sin entregar') || estEntrega.includes('no se ha enviado')) {
            status = 'No entregado';
          } else if (details.hecho_calificacion) {
            status = 'Entregado';
          } else {
            status = 'No entregado';
          }
        }
      }
      return { status, grade, gradeOver };
    };

    // Parallel scraper with pool limit of 4 concurrency
    const concurrencyPool = 4;
    let processed = 0;

    const workerFn = async (currentItem: any) => {
      // Check cancellation prior to fetching details
      const currentJobCheck = syncJobs.get(key);
      if (!currentJobCheck || currentJobCheck.status === 'idle') {
        return;
      }

      const taskStart = Date.now();
      const sess = sessions[currentItem.sessionIndex];
      if (!sess) {
        processed++;
        return;
      }

      job.currentCourse = currentItem.courseName;
      job.currentActivity = currentItem.activityName;
      job.processedCount = processed;
      syncJobs.set(key, { ...job });

      try {
        const activityHtml = await fetchMoodleHtml(currentItem.activityUrl, sess.cookies);
        const $ = cheerio.load(activityHtml);

        let domAperture: string | null = null;
        let domClosure: string | null = null;
        $('[data-region="activity-dates"], .rui-activity-dates, .activity-dates, .activity-dates-wrapper, .rui-activity-information').find('div, p, span').each((_, el) => {
          const text = $(el).text().trim();
          if (!text) return;
          const lower = text.toLowerCase();
          const isAp = lower.startsWith('abre:') || lower.startsWith('apertura:') || lower.startsWith('abrió:') || lower.startsWith('disponible desde:') || lower.startsWith('opened:');
          const isCl = lower.startsWith('cierra:') || lower.startsWith('cierre:') || lower.startsWith('cerró:') || lower.startsWith('disponible hasta:') || lower.startsWith('fecha de entrega:') || lower.startsWith('closed:') || lower.startsWith('due:');
          if (isAp) {
            const val = text.substring(text.indexOf(':') + 1).trim();
            if (val && !domAperture) domAperture = val;
          } else if (isCl) {
            const val = text.substring(text.indexOf(':') + 1).trim();
            if (val && !domClosure) domClosure = val;
          }
        });

        const $clone = $('body').clone();
        $clone.find('div, p, br, h1, h2, h3, h4, h5, h6, li, tr, td, section, aside, header, footer').after('\n');
        const pageText = $clone.text() || $.text() || '';

        const dates = {
          aperture: domAperture,
          apertureDateISO: null as string | null,
          closure: domClosure,
          closureDateISO: null as string | null
        };

        if (!dates.aperture) {
          const aperturePatterns = [/Apertura:\s*([^\n<]+)/i, /Apre:\s*([^\n<]+)/i, /Abrió:\s*([^\n<]+)/i, /Disponible desde:\s*([^\n<]+)/i, /Opened:\s*([^\n<]+)/i];
          for (const r of aperturePatterns) {
            const m = pageText.match(r);
            if (m && m[1]) {
              const val = m[1].trim();
              if (!val.includes('Cierre') && !val.includes('Cerró') && !val.includes('Cierra') && !val.includes('Disponible hasta')) {
                dates.aperture = val; break;
              }
            }
          }
        }

        if (!dates.closure) {
          const closurePatterns = [/Cierre:\s*([^\n<]+)/i, /Cierra:\s*([^\n<]+)/i, /Cerró:\s*([^\n<]+)/i, /Disponible hasta:\s*([^\n<]+)/i, /Fecha de entrega:\s*([^\n<]+)/i, /Closed:\s*([^\n<]+)/i, /Due:\s*([^\n<]+)/i];
          for (const r of closurePatterns) {
            const m = pageText.match(r);
            if (m && m[1]) {
              const val = m[1].trim();
              if (!val.includes('Apertura') && !val.includes('Abrió') && !val.includes('Abre') && !val.includes('Disponible desde')) {
                dates.closure = val; break;
              }
            }
          }
        }

        if (dates.closure) dates.closureDateISO = parseMoodleSpanishDate(dates.closure);
        if (dates.aperture) dates.apertureDateISO = parseMoodleSpanishDate(dates.aperture);

        const isAssign = currentItem.activityUrl.includes('mod/assign');
        const isQuiz = currentItem.activityUrl.includes('mod/quiz');
        const tipo_actividad = isAssign ? 'Tarea' : (isQuiz ? 'Cuestionario' : 'Actividad');

        const detailsInfo: any = {
          aperture: dates.aperture,
          apertureDateISO: dates.apertureDateISO,
          closure: dates.closure,
          closureDateISO: dates.closureDateISO,
          tipo_actividad,
          requisitos_pendientes: [] as string[],
          requisitos_completados: [] as string[],
          archivos_enviados: [],
          archivos_adicionales: [],
          detalle: null,
          quiz_info: null
        };

        $('.badge-sm, .badge').each((_, badge) => {
          const badgeText = $(badge).text().trim();
          if (badgeText.startsWith('Hecho:')) detailsInfo.requisitos_completados.push(badgeText.replace('Hecho:', '').trim());
          else if (badgeText.startsWith('Por hacer:')) detailsInfo.requisitos_pendientes.push(badgeText.replace('Por hacer:', '').trim());
        });

        if (isAssign) {
          const submissionTable = $('.submissionsummarytable, .submissionstatustable, table:contains("Estado de la entrega")').first();
          const tableDetails: Record<string, string> = {};
          if (submissionTable.length > 0) {
            submissionTable.find('tr').each((_, tr) => {
              const th = $(tr).find('th, td.cell.c0').first().text().trim().toLowerCase();
              const td = $(tr).find('td, td.cell.c1').last().text().trim();
              if (th && td && td !== '-') tableDetails[th] = td;
            });
          }
          detailsInfo.grupo = tableDetails['grupo'] || tableDetails['group'] || null;
          detailsInfo.intento = tableDetails['número del intento'] || tableDetails['intento'] || null;
          detailsInfo.estado_entrega = tableDetails['estado de la entrega'] || tableDetails['submission status'] || null;
          detailsInfo.estado_calificacion = tableDetails['estado de la calificación'] || tableDetails['grading status'] || null;
          detailsInfo.tiempo_restante = tableDetails['tiempo restante'] || tableDetails['time remaining'] || null;
          detailsInfo.ultima_modificacion = tableDetails['última modificación'] || tableDetails['last modified'] || null;

          if (submissionTable.length > 0) {
            submissionTable.find('tr').each((_, tr) => {
              const thText = $(tr).find('th, td.cell.c0').first().text().trim().toLowerCase();
              if (thText.includes('archivos enviados') || thText.includes('file submissions')) {
                $(tr).find('a[href]').each((_, a) => {
                  const urlObj = $(a).attr('href') || '';
                  const nombre = $(a).text().trim();
                  if (nombre && urlObj) detailsInfo.archivos_enviados.push({ nombre, url: urlObj });
                });
              }
            });
          }

          const gradeTable = $('.feedback table.generaltable, .feedbacktable table');
          if (gradeTable.length > 0) {
            gradeTable.find('tr').each((_, tr) => {
              const th = $(tr).find('th').first().text().trim().toLowerCase();
              const td = $(tr).find('td').last().text().trim();
              if (th && td) {
                if (th.includes('calificación') || th.includes('grade')) {
                  const m = td.match(/(\d+[.,]?\d*)\s*[/]\s*(\d+[.,]?\d*)/);
                  if (m) {
                    detailsInfo.calificacion = m[1];
                    detailsInfo.calificacion_sobre = m[2];
                  } else {
                    detailsInfo.calificacion = td;
                  }
                } else if (th.includes('fecha') || th.includes('date')) {
                  detailsInfo.fecha_calificacion = td;
                } else if (th.includes('calificado por') || th.includes('graded by')) {
                  detailsInfo.calificado_por = $(tr).find('td a').first().text().trim() || td;
                }
              }
            });
          }
          const commentElem = $('.feedback .comment, .feedbacktable, .feedback .no-overflow');
          if (commentElem.length > 0) {
            detailsInfo.comentario_calificador = commentElem.text().trim().replace(/^Comentarios?/i, '').trim();
          }
        }

        if (isQuiz) {
          const quiz_info: any = { intentos_permitidos: null, limite_tiempo: null, calificacion_final: null, calificacion_sobre: null, porcentaje: null, intentos: [] };
          const matchIntentos = pageText.match(/Intentos permitidos:\s*(\d+)/i) || pageText.match(/Attempts allowed:\s*(\d+)/i);
          if (matchIntentos) quiz_info.intentos_permitidos = matchIntentos[1];
          const matchTiempo = pageText.match(/Límite de tiempo:\s*([^\n<]+)/i) || pageText.match(/Time limit:\s*([^\n<]+)/i);
          if (matchTiempo) quiz_info.limite_tiempo = matchTiempo[1].trim();
          
          const feedbackDiv = $('#feedback, .quizfeedback');
          if (feedbackDiv.length > 0) {
            const fbText = feedbackDiv.text().trim();
            const matchFinalGrade = fbText.match(/calificación final.*?(\d+[.,]?\d*)\s*[/]\s*(\d+[.,]?\d*)/i);
            if (matchFinalGrade) {
              quiz_info.calificacion_final = matchFinalGrade[1];
              quiz_info.calificacion_sobre = matchFinalGrade[2];
            }
            const matchPct = fbText.match(/\((\d+)%\)/);
            if (matchPct) quiz_info.porcentaje = matchPct[1];
          }

          $('.rui-attempts-list, table.quizattemptsummary').each((_, summary) => {
            $(summary).find('tr, .rounded.border').each((_, container) => {
              const attempt: any = { numero: null, estado: null, comenzado: null, completado: null, duracion: null, calificacion: null, calificacion_sobre: null, porcentaje: null, revision_url: null };
              const h4Val = $(container).find('h4, td.c0, th').first().text().trim();
              const matchNum = h4Val.match(/Intento\s*(\d+)/i) || h4Val.match(/Attempt\s*(\d+)/i) || h4Val.match(/^(\d+)$/);
              if (matchNum) attempt.numero = matchNum[1];
              if ($(container).hasClass('rounded')) {
                $(container).find('.rui-infobox').each((_, box) => {
                  const title = $(box).find('h5').text().trim().toLowerCase();
                  const value = $(box).find('.rui-infobox-content--small').text().trim();
                  if (title.includes('estado')) attempt.estado = value;
                  else if (title.includes('comenzado')) attempt.comenzado = value;
                  else if (title.includes('completo')) attempt.completado = value;
                  else if (title.includes('duración')) attempt.duracion = value;
                  else if (title.includes('calificación')) {
                    const m = value.match(/(\d+[.,]?\d*)\s+de\s+(\d+[.,]?\d*)\s*\((\d+)%\)/);
                    if (m) { attempt.calificacion = m[1]; attempt.calificacion_sobre = m[2]; attempt.porcentaje = m[3]; }
                    else { const mSimple = value.match(/(\d+[.,]?\d*)/); if (mSimple) attempt.calificacion = mSimple[1]; }
                  }
                });
              } else {
                const stateText = $(container).find('.state, td.c1').first().text().trim();
                if (stateText) attempt.estado = stateText;
                const gradeText = $(container).find('.grade, td.c2').first().text().trim();
                if (gradeText) attempt.calificacion = gradeText;
              }
              const revLink = $(container).find('a[href*="review.php"]');
              if (revLink.length > 0) attempt.revision_url = revLink.attr('href');
              if (attempt.numero || attempt.estado) quiz_info.intentos.push(attempt);
            });
          });
          detailsInfo.quiz_info = quiz_info;
        }

        const descriptionDiv = $('.activity-description, #intro, .activity-header');
        if (descriptionDiv.length > 0) {
          detailsInfo.detalle = descriptionDiv.text().trim();
          descriptionDiv.find('a[href]').each((_, lLink) => {
            const hHref = $(lLink).attr('href') || '';
            const tTexto = $(lLink).text().trim();
            if (hHref && tTexto && tTexto.length > 3) {
              if (hHref.includes('pluginfile') || hHref.endsWith('.pdf') || hHref.endsWith('.docx') || hHref.endsWith('.doc')) {
                detailsInfo.archivos_adicionales.push({ texto: tTexto, url: hHref });
              }
            }
          });
        }

        if (!detailsInfo.detalle && pageText) {
          const contentSnippet = pageText.split('Apertura:')[0]?.split('Límite de tiempo:')[0]?.substring(0, 400)?.trim();
          if (contentSnippet && contentSnippet.length > 20) detailsInfo.detalle = contentSnippet;
        }

        let advertencia_preguntas = null;
        if (pageText.includes('Aún no se han agregado preguntas') || activityHtml.includes('Aún no se han agregado preguntas')) {
          advertencia_preguntas = 'Aún no se han agregado preguntas';
        }
        detailsInfo.advertencia_preguntas = advertencia_preguntas;

        let por_hacer_calificacion = false;
        if (Array.isArray(detailsInfo.requisitos_pendientes)) {
          por_hacer_calificacion = detailsInfo.requisitos_pendientes.some((r: string) => r.toLowerCase().includes('recibir una calificación') || r.toLowerCase().includes('recibir una calificacion'));
        }
        if (!por_hacer_calificacion) {
          const lowerPage = pageText.toLowerCase();
          por_hacer_calificacion = lowerPage.includes('por hacer: recibir una calificación') || lowerPage.includes('por hacer: recibir una calificacion');
        }
        detailsInfo.por_hacer_calificacion = por_hacer_calificacion;

        let hecho_calificacion = false;
        if (Array.isArray(detailsInfo.requisitos_completados)) {
          hecho_calificacion = detailsInfo.requisitos_completados.some((r: string) => r.toLowerCase().includes('recibir una calificación') || r.toLowerCase().includes('recibir una calificacion'));
        }
        if (!hecho_calificacion) {
          const lowerPage = pageText.toLowerCase();
          hecho_calificacion = lowerPage.includes('hecho: recibir una calificación') || lowerPage.includes('hecho: recibir una calificacion');
        }
        detailsInfo.hecho_calificacion = hecho_calificacion;

        const computedStats = computeStatsServer(currentItem.type, detailsInfo);

        const newTodo = {
          id: `moodle-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
          title: currentItem.activityName,
          courseId: currentItem.courseId,
          courseName: currentItem.courseName,
          activityUrl: currentItem.activityUrl,
          type: currentItem.type,
          description: detailsInfo.detalle || undefined,
          closureDate: detailsInfo.closureDateISO || null,
          aperture: detailsInfo.aperture || null,
          apertureDateISO: detailsInfo.apertureDateISO || null,
          completed: !detailsInfo.por_hacer_calificacion && (
                       isStatusSubmittedServer(detailsInfo.estado_entrega) || 
                       detailsInfo.quiz_info?.intentos?.some((att: any) => att.estado?.toLowerCase().includes('terminado')) || 
                       (detailsInfo.hecho_calificacion === true) ||
                       (computedStats.status === 'Calificado' || computedStats.status === 'Entregado') ||
                       false
                     ),
          createdAt: new Date().toISOString(),
          status: computedStats.status,
          grade: computedStats.grade,
          gradeOver: computedStats.gradeOver,
          gradingStatus: (computedStats.grade || computedStats.status === 'Calificado' || (detailsInfo.estado_calificacion && detailsInfo.estado_calificacion.toLowerCase().includes('calificad'))) ? 'Calificado' : (detailsInfo.estado_calificacion || null),
          estado_calificacion: (computedStats.grade || computedStats.status === 'Calificado' || (detailsInfo.estado_calificacion && detailsInfo.estado_calificacion.toLowerCase().includes('calificad'))) ? 'Calificado' : (detailsInfo.estado_calificacion || null),
          estado_entrega: detailsInfo.estado_entrega || null,
          comentario_calificador: detailsInfo.comentario_calificador || null,
          advertencia_preguntas: detailsInfo.advertencia_preguntas || null,
          por_hacer_calificacion: detailsInfo.por_hacer_calificacion || false,
          hecho_calificacion: detailsInfo.hecho_calificacion || false,
          grupo: detailsInfo.grupo || null,
          moodleUsername: currentItem.username,
          moodleServer: currentItem.server,
          lastSyncedAt: new Date().toISOString()
        };

        const existingIdx = job.tasks.findIndex(t => t.activityUrl === currentItem.activityUrl);
        if (existingIdx !== -1) {
          job.tasks[existingIdx] = newTodo;
        } else {
          job.tasks.push(newTodo);
        }
        
        const taskDuration = Date.now() - taskStart;
        addLog(job, 'performance', `[FETCH_DETAIL] ADDR="${currentItem.activityUrl}" | TYPE=${currentItem.type} | COURSE_ID=${currentItem.courseId} | TITLE="${currentItem.activityName}" | STATUS="${computedStats.status}" | CALIF="${computedStats.grade || 'N/A'}/${computedStats.gradeOver || '100'}" | ENTREGA="${detailsInfo.estado_entrega || 'N/A'}" | CALIFIC_REQ=${detailsInfo.hecho_calificacion}`, taskDuration);
      } catch (err: any) {
        const taskDuration = Date.now() - taskStart;
        addLog(job, 'warn', `[DETAIL_PARSE_FAIL] URL="${currentItem.activityUrl}" | TARGET_NAME="${currentItem.activityName}" | MSG="${err.message}" | STACK="${err.stack ? err.stack.split('\n')[0] : 'N/A'}"`, taskDuration);
        const lowerMsg = (err.message || '').toLowerCase();
        const isSessionExpired = lowerMsg.includes('expiró') || lowerMsg.includes('expirada') || lowerMsg.includes('expirado') || lowerMsg.includes('inválida') || lowerMsg.includes('invalida') || lowerMsg.includes('sesión') || lowerMsg.includes('sesion');
        if (isSessionExpired) {
          console.warn(`[Expected Expiry] Background download details exception for ${currentItem.activityName} had expired session.`);
        } else {
          console.error(`Background download details exception for ${currentItem.activityName}:`, err);
        }
      }

      processed++;
      job.processedCount = processed;
      if (processed % 5 === 0 || processed === job.totalCount) {
        await saveJobToDisk(key, job);
      }
    };

    addLog(job, 'info', `[BATCH_QUE_START] QUE_LENGTH=${workingQueue.length} | CONCURRENCY_MAX=${concurrencyPool} | POOL_TYPE="Promise.race"`);
    const detailsStart = Date.now();
    await processQueueConcurrently(workingQueue, concurrencyPool, workerFn);
    const detailsDuration = Date.now() - detailsStart;
    addLog(job, 'success', `[BATCH_QUE_FINISHED] QUE_LENGTH=${workingQueue.length} | ACTIVE_THREAD_RELEASES=all | DURATION=${detailsDuration}ms`, detailsDuration);

    // Ensure we don't overwrite if canceled mid-job
    const finalJobCheck = syncJobs.get(key);
    if (finalJobCheck && finalJobCheck.status === 'syncing') {
      job.status = 'completed';
      job.currentCourse = '';
      job.currentActivity = '';
      addLog(job, 'success', `[SYNC_COMPLETED_SUCCESSFULLY] STATE_PERSISTENCE="sync_${key}.json" | COMMITTED_TODOS_COUNT=${job.tasks.length} | STATUS="completed"`);
      await saveJobToDisk(key, job);
      syncJobs.set(key, job);
    }

  } catch (err: any) {
    console.error('Unified background sync error:', err);
    job.status = 'failed';
    job.error = err.message || 'Error de conexión con Moodle';
    addLog(job, 'error', `[SYNC_FAILED_CRITICAL] EXCEPTION_MSG="${err.message}" | STACK="${err.stack ? err.stack.replace(/\n/g, ' -> ') : 'N/A'}" | STATUS="failed"`);
    await saveJobToDisk(key, job);
    syncJobs.set(key, job);
  }
}

// REST Endpoints: Background Sync Trigger
app.post('/api/moodle/sync/start', async (req, res) => {
  const { sessions } = req.body;
  if (!sessions || !Array.isArray(sessions) || sessions.length === 0) {
    return res.status(400).json({ error: 'Faltan conexiones de Moodle para iniciar sincronización' });
  }

  const key = sessions.map(s => s.username.toLowerCase()).sort().join('_');
  
  let existingJob = syncJobs.get(key);
  if (!existingJob) {
    existingJob = await loadJobFromDisk(key);
  }

  if (existingJob && existingJob.status === 'syncing') {
    return res.json({ success: true, key, status: 'running', job: existingJob });
  }

  const newJob: SyncJob = {
    key,
    status: 'syncing',
    currentCourse: 'Mapeando materias...',
    currentActivity: 'Leyendo estructura general...',
    processedCount: 0,
    totalCount: 0,
    tasks: [],
    lastActive: Date.now(),
    logs: [
      {
        timestamp: new Date().toTimeString().split(' ')[0] + '.' + String(new Date().getMilliseconds()).padStart(3, '0'),
        type: 'info',
        message: 'Iniciando proceso completo de sincronización global.'
      }
    ]
  };

  syncJobs.set(key, newJob);
  await saveJobToDisk(key, newJob);

  runBackgroundSync(key, sessions).catch(err => {
    console.error('Fatal async sync failure:', err);
  });

  return res.json({ success: true, key, status: 'started', job: newJob });
});

// REST Endpoints: Background Sync Polling
app.post('/api/moodle/sync/status', async (req, res) => {
  const { key } = req.body;
  if (!key) {
    return res.status(400).json({ error: 'Falta clave identificadora del job' });
  }

  let job = syncJobs.get(key);
  if (!job) {
    job = await loadJobFromDisk(key);
    if (job) {
      syncJobs.set(key, job);
    }
  }

  if (!job) {
    return res.json({ status: 'idle' });
  }

  return res.json({ job });
});

// REST Endpoints: Background Sync Cancellation
app.post('/api/moodle/sync/cancel', async (req, res) => {
  const { key } = req.body;
  if (!key) {
    return res.status(400).json({ error: 'Falta clave identificadora' });
  }

  let job = syncJobs.get(key);
  if (!job) job = await loadJobFromDisk(key);
  
  if (job) {
    job.status = 'idle';
    job.processedCount = 0;
    job.totalCount = 0;
    job.tasks = [];
    syncJobs.set(key, job);
    await saveJobToDisk(key, job);
  }

  return res.json({ success: true });
});

// Configure Vite integration
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
