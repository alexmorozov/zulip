var people = (function () {

var exports = {};

var people_dict;
var people_by_name_dict;
var people_by_user_id_dict;
var realm_people_dict;
var cross_realm_dict;
var pm_recipient_count_dict;
var my_user_id;

// We have an init() function so that our automated tests
// can easily clear data.
exports.init = function () {
    // The following three Dicts point to the same objects
    // All people we've seen
    people_dict = new Dict({fold_case: true});
    people_by_name_dict = new Dict({fold_case: true});
    people_by_user_id_dict = new Dict();
    // People in this realm
    realm_people_dict = new Dict({fold_case: true});
    cross_realm_dict = new Dict({fold_case: true});
    pm_recipient_count_dict = new Dict({fold_case: true});
};

// WE INITIALIZE DATA STRUCTURES HERE!
exports.init();

exports.get_person_from_user_id = function (user_id) {
    if (!people_by_user_id_dict.has(user_id)) {
        blueslip.error('Unknown user_id in get_person_from_user_id: ' + user_id);
        return undefined;
    }
    return people_by_user_id_dict.get(user_id);
};

exports.get_by_email = function get_by_email(email) {
    return people_dict.get(email);
};

exports.get_user_id = function (email) {
    var person = people_dict.get(email);
    if (person === undefined) {
        // Our blueslip reporting here is a bit complicated, but
        // there are known race conditions after reload, and we
        // expect occasional failed lookups, but they should resolve
        // after five seconds.
        var error_msg = 'Unknown email for get_user_id: ' + email;
        blueslip.debug(error_msg);
        setTimeout(function () {
            if (!people_dict.has(email)) {
                blueslip.error(error_msg);
            }
        }, 5000);
        return undefined;
    }
    var user_id = person.user_id;
    if (!user_id) {
        blueslip.error('No userid found for ' + email);
        return undefined;
    }

    return user_id;
};

exports.user_ids_string_to_emails_string = function (user_ids_string) {
    var user_ids = user_ids_string.split(',');
    var emails = _.map(user_ids, function (user_id) {
        var person = people_by_user_id_dict.get(user_id);
        if (person) {
            return person.email;
        }
    });

    if (!_.all(emails)) {
        blueslip.error('Unknown user ids: ' + user_ids_string);
        return;
    }

    emails = _.map(emails, function (email) {
        return email.toLowerCase();
    });

    emails.sort();

    return emails.join(',');
};

exports.emails_strings_to_user_ids_string = function (emails_string) {
    var emails = emails_string.split(',');
    var user_ids = _.map(emails, function (email) {
        var person = people_dict.get(email);
        if (person) {
            return person.user_id;
        }
    });

    if (!_.all(user_ids)) {
        blueslip.warn('Unknown emails: ' + emails_string);
        return;
    }

    user_ids.sort();

    return user_ids.join(',');
};

exports.get_full_name = function (user_id) {
    return people_by_user_id_dict.get(user_id).full_name;
};

exports.get_recipients = function (user_ids_string) {
    // See message_store.get_pm_full_names() for a similar function.

    var user_ids = user_ids_string.split(',');
    var other_ids = _.reject(user_ids, exports.is_my_user_id);

    if (other_ids.length === 0) {
        // private message with oneself
        return exports.my_full_name();
    }

    var names = _.map(other_ids, exports.get_full_name).sort();
    return names.join(', ');
};

exports.emails_to_slug = function (emails_string) {
    var slug = exports.emails_strings_to_user_ids_string(emails_string);

    if (!slug) {
        return;
    }

    slug += '-';

    var emails = emails_string.split(',');

    if (emails.length === 1) {
        slug += emails[0].split('@')[0].toLowerCase();
    } else {
        slug += 'group';
    }

    return slug;
};

exports.slug_to_emails = function (slug) {
    var m = /^([\d,]+)-/.exec(slug);
    if (m) {
        var user_ids = m[1];
        return exports.user_ids_string_to_emails_string(user_ids);
    }
};

exports.format_small_avatar_url = function (raw_url, sent_by_me) {
    var url = raw_url + "&s=50";
    if (sent_by_me) {
        url += "&stamp=" + settings.avatar_stamp;
    }
    return url;
};

exports.small_avatar_url = function (message) {
    // Try to call this function in all places where we need 25px
    // avatar images, so that the browser can help
    // us avoid unnecessary network trips.  (For user-uploaded avatars,
    // the s=25 parameter is essentially ignored, but it's harmless.)
    //
    // We actually request these at s=50, so that we look better
    // on retina displays.

    var url = "";
    var person;

    if (message.sender_id) {
        // We should always have message.sender_id, except for in the
        // tutorial, where it's ok to fall back to the url in the fake
        // messages.
        person = exports.get_person_from_user_id(message.sender_id);
    }

    // The first time we encounter a sender in a message, we may
    // not have person.avatar_url set, but if we do, then use that.
    if (person && person.avatar_url) {
        url = person.avatar_url;
    } else if (message.avatar_url) {
        // Here we fall back to using the avatar_url from the message
        // itself.
        url = message.avatar_url;
        if (person) {
            person.avatar_url = url;
        }
    }

    if (url) {
        url = exports.format_small_avatar_url(url, message.sent_by_me);
    }

    return url;
};

exports.realm_get = function realm_get(email) {
    return realm_people_dict.get(email);
};

exports.get_all_persons = function () {
    return people_dict.values();
};

exports.get_realm_persons = function () {
    return realm_people_dict.values();
};

exports.is_cross_realm_email = function (email) {
    return cross_realm_dict.has(email);
};

exports.get_recipient_count = function (person) {
    // We can have fake person objects like the "all"
    // pseudo-person in at-mentions.  They will have
    // the pm_recipient_count on the object itself.
    if (person.pm_recipient_count) {
        return person.pm_recipient_count;
    }

    var count = pm_recipient_count_dict.get(person.email);

    return count || 0;
};

exports.incr_recipient_count = function (email) {
    var old_count = pm_recipient_count_dict.get(email) || 0;
    pm_recipient_count_dict.set(email, old_count + 1);
};

exports.filter_people_by_search_terms = function (users, search_terms) {
        var filtered_users = new Dict();

        var matchers = _.map(search_terms, function (search_term) {
            var termlets = search_term.toLowerCase().split(/\s+/);
            termlets = _.map(termlets, function (termlet) {
                return termlet.trim();
            });

            return function (email, names) {
                if (email.indexOf(search_term.trim()) === 0) {
                    return true;
                }
                return _.all(termlets, function (termlet) {
                    return _.any(names, function (name) {
                        if (name.indexOf(termlet) === 0) {
                            return true;
                        }
                    });
                });
            };
        });


        // Loop through users and populate filtered_users only
        // if they include search_terms
        _.each(users, function (user) {
            var person = exports.get_by_email(user.email);
            // Get person object (and ignore errors)
            if (!person || !person.full_name) {
                return;
            }

            var email = user.email.toLowerCase();

            // Remove extra whitespace
            var names = person.full_name.toLowerCase().split(/\s+/);
            names = _.map(names, function (name) {
                return name.trim();
            });


            // Return user emails that include search terms
            var match = _.any(matchers, function (matcher) {
                return matcher(email, names);
            });

            if (match) {
                filtered_users.set(person.user_id, true);
            }
        });
        return filtered_users;
};

exports.get_by_name = function realm_get(name) {
    return people_by_name_dict.get(name);
};

function people_cmp(person1, person2) {
    var name_cmp = util.strcmp(person1.full_name, person2.full_name);
    if (name_cmp < 0) {
        return -1;
    } else if (name_cmp > 0) {
        return 1;
    }
    return util.strcmp(person1.email, person2.email);
}

exports.get_rest_of_realm = function get_rest_of_realm() {
    var people_minus_you = [];
    realm_people_dict.each(function (person) {
        if (!exports.is_current_user(person.email)) {
            people_minus_you.push({email: person.email,
                                   user_id: person.user_id,
                                   full_name: person.full_name});
        }
    });
    return people_minus_you.sort(people_cmp);
};

exports.add = function add(person) {
    if (person.user_id) {
        people_by_user_id_dict.set(person.user_id, person);
    } else {
        // We eventually want to lock this down completely
        // and report an error and not update other the data
        // structures here, but we have a lot of edge cases
        // with cross-realm bots, zephyr users, etc., deactivated
        // users, where we are probably fine for now not to
        // find them via user_id lookups.
        blueslip.warn('No user_id provided for ' + person.email);
    }

    people_dict.set(person.email, person);
    people_by_name_dict.set(person.full_name, person);
};

exports.add_in_realm = function add_in_realm(person) {
    realm_people_dict.set(person.email, person);
    exports.add(person);
};

exports.deactivate = function (person) {
    // We don't fully remove a person from all of our data
    // structures, because deactivated users can be part
    // of somebody's PM list.
    realm_people_dict.del(person.email);
};

exports.extract_people_from_message = function (message) {
    var involved_people;

    switch (message.type) {
    case 'stream':
        involved_people = [{full_name: message.sender_full_name,
                            user_id: message.sender_id,
                            email: message.sender_email}];
        break;

    case 'private':
        involved_people = message.display_recipient;
        break;
    }

    // Add new people involved in this message to the people list
    _.each(involved_people, function (person) {
        if (!person.unknown_local_echo_user) {
            if (! exports.get_by_email(person.email)) {
                exports.add({
                    email: person.email,
                    user_id: person.user_id || person.id,
                    full_name: person.full_name,
                    is_admin: person.is_realm_admin || false,
                    is_bot: person.is_bot || false,
                });
            }

            if (message.type === 'private' && message.sent_by_me) {
                // Track the number of PMs we've sent to this person to improve autocomplete
                exports.incr_recipient_count(person.email);
            }
        }
    });
};

exports.set_full_name = function (person_obj, new_full_name) {
    if (people_by_name_dict.has(person_obj.full_name)) {
        people_by_name_dict.del(person_obj.full_name);
    }
    people_by_name_dict.set(new_full_name, person_obj);
    person_obj.full_name = new_full_name;
};

exports.is_current_user = function (email) {
    if (email === null || email === undefined) {
        return false;
    }

    return email.toLowerCase() === exports.my_current_email().toLowerCase();
};

exports.initialize_current_user = function (user_id) {
    my_user_id = user_id;
};

exports.my_full_name = function () {
    return people_by_user_id_dict.get(my_user_id).full_name;
};

exports.my_current_email = function () {
    return people_by_user_id_dict.get(my_user_id).email;
};

exports.my_current_user_id = function () {
    return my_user_id;
};

exports.is_my_user_id = function (user_id) {
    if (!user_id) {
        return false;
    }
    return user_id.toString() === my_user_id.toString();
};

$(function () {
    _.each(page_params.people_list, function (person) {
        exports.add_in_realm(person);
    });

    _.each(page_params.cross_realm_bots, function (person) {
        if (!people_dict.has(person.email)) {
            exports.add(person);
        }
        cross_realm_dict.set(person.email, person);
    });

    exports.initialize_current_user(page_params.user_id);

    delete page_params.people_list; // We are the only consumer of this.
    delete page_params.cross_realm_bots;
});

return exports;

}());
if (typeof module !== 'undefined') {
    module.exports = people;
}
